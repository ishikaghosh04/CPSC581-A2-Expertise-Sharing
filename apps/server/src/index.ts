import { existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';

import express from 'express';
import { Server } from 'socket.io';

import type {
  Attempt,
  AttemptFeedback,
  AttemptReview,
  AudioFeedbackAttribute,
  CameraState,
  ClientToServerEvents,
  LightState,
  Role,
  SceneId,
  ServerToClientEvents,
  StateSnapshot,
  TaskTarget,
  TaskEntry,
} from '@expertise-sharing/shared';
import {
  compareTaskStates,
  DEFAULT_TOLERANCES,
  feedbackSuggestions,
  nextTaskHint,
  SCENES,
} from '@expertise-sharing/shared';

import { renderReferencePlaceholder } from './reference.js';
import {
  claimRole,
  dropIfEmpty,
  getSession,
  getSessionBySocket,
  newSession,
  releaseMember,
  sessionMeta,
  type Session,
} from './sessions.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_CHAT_LENGTH = 500;
const MAX_FEEDBACK_LENGTH = 1000;
const AUDIO_FEEDBACK_ATTRIBUTES: AudioFeedbackAttribute[] = [
  'camera-position',
  'camera-aim',
  'light-position',
  'light-aim',
  'intensity',
];

function audioFeedbackMetrics(
  diff: ReturnType<typeof compareTaskStates>,
  attribute: AudioFeedbackAttribute
): { distance: number; tolerance: number } {
  switch (attribute) {
    case 'camera-position':
      return { distance: diff.cameraPositionDistance, tolerance: DEFAULT_TOLERANCES.position };
    case 'camera-aim':
      return { distance: diff.cameraTargetDistance, tolerance: DEFAULT_TOLERANCES.position };
    case 'light-position':
      return { distance: diff.lightPositionDistance, tolerance: DEFAULT_TOLERANCES.position };
    case 'light-aim':
      return { distance: diff.lightAimAngleDegrees, tolerance: DEFAULT_TOLERANCES.angle };
    case 'intensity':
      return { distance: diff.lightIntensityDifference, tolerance: DEFAULT_TOLERANCES.intensity };
  }
}

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
// Reference/attempt PNG data URLs can be large; engine.io's default 1 MB packet
// limit would silently drop them. Applied before any client can connect.
(io.engine.opts as { maxPayload?: number }).maxPayload = 5 * 1024 * 1024;

io.on('connection', (socket) => {
  let role: Role | undefined;
  
  // Phone controllers pair without occupying an expert/novice role.
  let phoneSessionCode: string | null = null;
  let phoneTargetRole: Role = 'expert';
  let lastPhoneUpdate = 0;

  socket.on('phone:pair', (code, targetRole, ack) => {
    const session = getSession(code);

    if (!session || (targetRole !== 'expert' && targetRole !== 'novice')) {
      ack({ ok: false, error: 'Invalid session code or role.' });
      return;
    }

    phoneSessionCode = session.code;
    phoneTargetRole = targetRole;
    ack({ ok: true });
  });

  socket.on('phone:orientation', ({ x, y, z }) => {
    if (!phoneSessionCode) return;
    if (!getSession(phoneSessionCode)) return;
    if (![x, y, z].every(Number.isFinite)) return;

    // Limit updates to approximately 20 per second.
    const now = Date.now();
    if (now - lastPhoneUpdate < 50) return;
    lastPhoneUpdate = now;

    io.to(phoneSessionCode).emit('phone:orientation', {
      targetRole: phoneTargetRole,
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
      z: Math.max(-1, Math.min(1, z)),
    });
  });

  let audioFeedbackSelection: {
    taskId: number;
    attribute: AudioFeedbackAttribute;
    lastDistance: number;
    lastCueDistance: number;
  } | null = null;

  const sessionOf = (): Session | undefined => getSessionBySocket(socket.id);

  socket.on('session:create', (ack) => {
    const existing = sessionOf();
    if (existing && role) {
      socket.join(existing.code);
      ack(sessionMeta(existing));
      return;
    }
    const session = newSession();
    if (!claimRole(session, 'expert', socket.id)) {
      dropIfEmpty(session);
      return;
    }
    role = 'expert';
    socket.join(session.code);
    ack(sessionMeta(session));
    io.to(session.code).emit('session:meta', sessionMeta(session));
  });

  socket.on('session:join', (rawCode, ack) => {
    const existing = sessionOf();
    if (existing && role) {
      socket.join(existing.code);
      ack({ ok: true, role, meta: sessionMeta(existing) });
      return;
    }
    const session = getSession(rawCode);
    if (!session) {
      ack({ ok: false, error: 'Session not found.' });
      return;
    }
    if (!claimRole(session, 'novice', socket.id)) {
      ack({ ok: false, error: 'A novice has already joined this session.' });
      return;
    }
    role = 'novice';
    socket.join(session.code);
    ack({ ok: true, role, meta: sessionMeta(session) });
    // Late joiners see the current reference image straight away.
    if (session.phase === 'task' && session.referenceImage && session.currentTaskId !== null) {
      const currentTask = session.tasks.find((task) => task.id === session.currentTaskId);
      if (currentTask) {
        socket.emit('task:start', {
          taskId: currentTask.id,
          referenceImage: session.referenceImage,
          scene: currentTask.scene,
        });
      }
    }
    if (session.attempts.length > 0) {
      socket.emit('attempts:current', session.attempts);
    }
    socket.emit('feedback:current', [...session.attemptFeedback.values()]);
    if (session.tasks.length > 0) {
      socket.emit('tasks:current', session.tasks);
    }
    io.to(session.code).emit('session:meta', sessionMeta(session));
  });

  socket.on('state:update', ({ camera, light }: StateSnapshot) => {
    const session = sessionOf();
    if (!session || !role) return;
    session.live[role] = { camera, light };
    socket.to(session.code).emit('peer:update', { from: role, snapshot: { camera, light } });

    if (role !== 'novice' || !audioFeedbackSelection) return;
    const selection = audioFeedbackSelection;
    const target = session.taskTargets.get(selection.taskId);
    if (!target) {
      audioFeedbackSelection = null;
      socket.emit('audio-feedback:error', 'The selected task is no longer available for audio feedback.');
      return;
    }
    const { distance, tolerance } = audioFeedbackMetrics(
      compareTaskStates(target, { camera, light }),
      selection.attribute
    );
    const movedAway = distance > selection.lastDistance;
    const enteredTolerance = selection.lastDistance > tolerance && distance <= tolerance;
    const improvedEnough = selection.lastCueDistance - distance >= tolerance * 0.05;
    if (improvedEnough || enteredTolerance) {
      socket.emit('audio-feedback:progress', {
        taskId: selection.taskId,
        attribute: selection.attribute,
        withinTolerance: distance <= tolerance,
        enteredTolerance,
      });
      selection.lastCueDistance = distance;
    } else if (movedAway) {
      selection.lastCueDistance = distance;
    }
    selection.lastDistance = distance;
  });

  socket.on('task:publish', ({ camera, light, referenceImage, scene: requestedScene }) => {
    const session = sessionOf();
    if (!session || role !== 'expert') return;
    // Scenes are shared context; an unknown/missing id falls back to classic.
    const sceneId: SceneId = SCENES.some((item) => item.id === requestedScene)
      ? requestedScene
      : 'classic';
    // Use the expert-side capture when present; otherwise fall back to a placeholder.
    session.referenceImage =
      typeof referenceImage === 'string' && referenceImage.startsWith('data:image/')
        ? referenceImage
        : renderReferencePlaceholder({ camera, light, referenceImage, scene: sceneId });
    session.phase = 'task';
    session.submitted = false;

    // Register the task in history and broadcast it to both clients.
    const task: TaskEntry = {
      id: session.nextTaskId++,
      referenceImage: session.referenceImage,
      scene: sceneId,
      createdAt: Date.now(),
    };
    const target: TaskTarget = {
      camera,
      light,
      referenceImage: session.referenceImage,
      scene: sceneId,
    };
    session.taskTargets.set(task.id, target);
    session.tasks.push(task);
    session.currentTaskId = task.id;
    io.to(session.code).emit('task:start', {
      taskId: task.id,
      referenceImage: session.referenceImage,
      scene: sceneId,
    });
    io.to(session.code).emit('task:published', task);
    io.to(session.code).emit('session:meta', sessionMeta(session));
  });

  socket.on('hint:request', ({ taskId, snapshot }) => {
    const session = sessionOf();
    if (!session || role !== 'novice') return;
    const target = session.taskTargets.get(taskId);
    if (!target) {
      socket.emit('hint:error', 'That task is no longer available for hints.');
      return;
    }
    socket.emit('hint:result', nextTaskHint(target, snapshot));
  });

  socket.on('audio-feedback:select', (selection) => {
    if (role !== 'novice') return;
    audioFeedbackSelection = null;
    if (!selection) {
      return;
    }
    if (
      !Number.isSafeInteger(selection.taskId) ||
      !AUDIO_FEEDBACK_ATTRIBUTES.includes(selection.attribute)
    ) {
      socket.emit('audio-feedback:error', 'That audio feedback selection is invalid.');
      return;
    }
    const session = sessionOf();
    const target = session?.taskTargets.get(selection.taskId);
    if (!session || !target) {
      socket.emit('audio-feedback:error', 'That task is no longer available for audio feedback.');
      return;
    }
    const initialDiff = compareTaskStates(target, selection.snapshot);
    const initialDistance = audioFeedbackMetrics(initialDiff, selection.attribute).distance;
    audioFeedbackSelection = {
      taskId: selection.taskId,
      attribute: selection.attribute,
      lastDistance: initialDistance,
      lastCueDistance: initialDistance,
    };
  });

  socket.on('attempt:submit', (payload) => {
    const session = sessionOf();
    if (!session || role !== 'novice') return;
    // Multiple attempts allowed while a task is live (task or already-submitted phase).
    if (session.phase !== 'task' && session.phase !== 'submitted') return;
    if (
      typeof payload.image !== 'string' ||
      !payload.image.startsWith('data:image/')
    ) {
      return;
    }
    const requestedTaskId = payload.taskId;
    const targetTask = session.tasks.find((t) => t.id === requestedTaskId);
    const taskId = targetTask ? targetTask.id : session.currentTaskId;
    if (taskId === null) return;
    const target = session.taskTargets.get(taskId);
    if (!target) return;
    const attempt: Attempt = {
      id: session.nextAttemptId++,
      taskId,
      scene: target.scene,
      image: payload.image,
      camera: payload.camera,
      light: payload.light,
      createdAt: Date.now(),
    };
    session.attempts.push(attempt);
    session.phase = 'submitted';
    session.submitted = true;
    io.to(session.code).emit('attempt:saved', attempt);
    io.to(session.code).emit('chat:message', {
      from: 'novice',
      text: `Submitted Attempt ${attempt.id}.`,
    });
    io.to(session.code).emit('attempt:submitted');
    const expertId = session.members.expert;
    if (expertId) {
      const snapshot = { camera: attempt.camera, light: attempt.light };
      const review: AttemptReview = {
        attemptId: attempt.id,
        taskId,
        diff: compareTaskStates(target, snapshot),
        suggestions: feedbackSuggestions(target, snapshot),
      };
      io.to(expertId).emit('attempt:review', review);
    }
    io.to(session.code).emit('session:meta', sessionMeta(session));
  });

  socket.on('feedback:send', ({ attemptId, text }) => {
    const session = sessionOf();
    if (!session || role !== 'expert') {
      socket.emit('feedback:error', 'Only the expert can send attempt feedback.');
      return;
    }
    const message = typeof text === 'string' ? text.trim() : '';
    if (
      !Number.isSafeInteger(attemptId) ||
      !session.attempts.some((attempt) => attempt.id === attemptId)
    ) {
      socket.emit('feedback:error', 'That submission is no longer available for feedback.');
      return;
    }
    if (message.length === 0 || message.length > MAX_FEEDBACK_LENGTH) {
      socket.emit('feedback:error', `Feedback must be 1-${MAX_FEEDBACK_LENGTH} characters.`);
      return;
    }
    const feedback: AttemptFeedback = {
      attemptId,
      text: message,
      createdAt: Date.now(),
      unread: true,
    };
    session.attemptFeedback.set(attemptId, feedback);
    const noviceId = session.members.novice;
    if (noviceId) {
      io.to(noviceId).emit('feedback:new', feedback);
    }
    socket.emit('feedback:saved', feedback);
    io.to(session.code).emit('chat:message', {
      from: 'expert',
      text: `Left feedback on Attempt ${attemptId}.`,
    });
  });

  socket.on('feedback:read', (attemptId) => {
    const session = sessionOf();
    if (!session || role !== 'novice' || !Number.isSafeInteger(attemptId)) return;
    const feedback = session.attemptFeedback.get(attemptId);
    if (feedback) {
      session.attemptFeedback.set(attemptId, { ...feedback, unread: false });
    }
  });

  socket.on('chat:message', (text) => {
    const session = sessionOf();
    if (!session || !role) return;
    const message = typeof text === 'string' ? text.trim() : '';
    if (message.length === 0 || message.length > MAX_CHAT_LENGTH) {
      socket.emit('chat:error', `Messages must be 1-${MAX_CHAT_LENGTH} characters.`);
      return;
    }
    io.to(session.code).emit('chat:message', { from: role, text: message });
  });

  socket.on('session:leave', () => {
    const session = sessionOf();
    if (!session || !role) return;
    releaseMember(session, socket.id);
    audioFeedbackSelection = null;
    if (!dropIfEmpty(session)) {
      io.to(session.code).emit('session:meta', sessionMeta(session));
    }
    role = undefined;
  });

  socket.on('disconnect', () => {
    const session = sessionOf();
    if (!session) return;
    releaseMember(session, socket.id);
    if (!dropIfEmpty(session)) {
      io.to(session.code).emit('session:meta', sessionMeta(session));
    }
  });
});

// Serve the built web client when it exists (production / plain `npm start`).
const webDist = path.resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
}

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server listening on http://localhost:${PORT}`);
});
