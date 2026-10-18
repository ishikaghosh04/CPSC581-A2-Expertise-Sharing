import { existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';

import express from 'express';
import { Server } from 'socket.io';

import type {
  Attempt,
  CameraState,
  ClientToServerEvents,
  LightState,
  Role,
  ServerToClientEvents,
  StateSnapshot,
  TaskEntry,
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

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
// Reference/attempt PNG data URLs can be large; engine.io's default 1 MB packet
// limit would silently drop them. Applied before any client can connect.
(io.engine.opts as { maxPayload?: number }).maxPayload = 5 * 1024 * 1024;

io.on('connection', (socket) => {
  let role: Role | undefined;

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
    if (session.phase === 'task' && session.referenceImage) {
      socket.emit('task:start', { referenceImage: session.referenceImage });
    }
    if (session.attempts.length > 0) {
      socket.emit('attempts:current', session.attempts);
    }
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
  });

  socket.on('task:publish', ({ camera, light, referenceImage }) => {
    const session = sessionOf();
    if (!session || role !== 'expert') return;
    session.target = { camera, light, referenceImage };
    // Use the expert-side capture when present; otherwise fall back to a placeholder.
    session.referenceImage =
      typeof referenceImage === 'string' && referenceImage.startsWith('data:image/')
        ? referenceImage
        : renderReferencePlaceholder({ camera, light, referenceImage });
    session.phase = 'task';
    session.submitted = false;

    // Register the task in history and broadcast it to both clients.
    const task: TaskEntry = {
      id: session.nextTaskId++,
      referenceImage: session.referenceImage,
      createdAt: Date.now(),
    };
    session.tasks.push(task);
    session.currentTaskId = task.id;
    io.to(session.code).emit('task:start', { referenceImage: session.referenceImage });
    io.to(session.code).emit('task:published', task);
    io.to(session.code).emit('session:meta', sessionMeta(session));
  });

  socket.on('attempt:submit', (payload) => {
    const session = sessionOf();
    if (!session || role !== 'novice') return;
    // Multiple attempts allowed while a task is live (task or already-submitted phase).
    if (session.phase !== 'task' && session.phase !== 'submitted') return;
    if (!session.target) return;
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
    const attempt: Attempt = {
      id: session.nextAttemptId++,
      taskId,
      image: payload.image,
      camera: payload.camera,
      light: payload.light,
      createdAt: Date.now(),
    };
    session.attempts.push(attempt);
    session.phase = 'submitted';
    session.submitted = true;
    io.to(session.code).emit('attempt:saved', attempt);
    io.to(session.code).emit('attempt:submitted');
    io.to(session.code).emit('session:meta', sessionMeta(session));
  });

  socket.on('chat:message', (text) => {
    const session = sessionOf();
    if (!session || !role) return;
    io.to(session.code).emit('chat:message', { from: role, text });
  });

  socket.on('session:leave', () => {
    const session = sessionOf();
    if (!session || !role) return;
    releaseMember(session, socket.id);
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
