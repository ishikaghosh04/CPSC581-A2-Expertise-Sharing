import { io, type Socket } from 'socket.io-client';

import type {
  Attempt,
  ClientToServerEvents,
  IntensityPreset,
  Role,
  ServerToClientEvents,
  SessionMeta,
  TaskEntry,
} from '@expertise-sharing/shared';

import { createScene, type LightHandle, type SceneHandle } from './scene.js';

const CODE_LENGTH = 5;

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

function el<T extends HTMLElement>(sel: string): T {
  const node = document.querySelector(sel);
  if (!node) throw new Error(`Element not found: ${sel}`);
  return node as T;
}

const landing = el<HTMLDivElement>('#landing');
const appView = el<HTMLDivElement>('#app');
const landingError = el<HTMLParagraphElement>('#landing-error');
const codeInput = el<HTMLInputElement>('#join-code');
const sessionCode = el<HTMLSpanElement>('#session-code');
const roleTag = el<HTMLSpanElement>('#role-tag');
const connectionState = el<HTMLSpanElement>('#connection-state');
const rolePanel = el<HTMLDivElement>('#role-panel');
const referenceImg = el<HTMLImageElement>('#reference');
const viewport = el<HTMLElement>('#viewport');
const sceneMount = el<HTMLDivElement>('#scene-mount');
const copyCodeBtn = el<HTMLButtonElement>('#copy-code');
const leaveBtn = el<HTMLButtonElement>('#leave-btn');
const toggleMoveBtn = el<HTMLButtonElement>('#toggle-move');
const toggleAimBtn = el<HTMLButtonElement>('#toggle-aim');
const resetCameraBtn = el<HTMLButtonElement>('#reset-camera');
const resetLightBtn = el<HTMLButtonElement>('#reset-light');
const previewPanel = el<HTMLElement>('#preview');
const previewCanvas = el<HTMLCanvasElement>('#preview-canvas');
const publishBtn = el<HTMLButtonElement>('#publish-btn');
const submitBtn = el<HTMLButtonElement>('#submit-btn');
const attemptsPanel = el<HTMLElement>('#attempts');
const workTaskRow = el<HTMLElement>('#work-task-row');
const workTaskSelect = el<HTMLSelectElement>('#work-task');
const taskSelect = el<HTMLSelectElement>('#task-select');
const attemptSelect = el<HTMLSelectElement>('#attempt-select');
const attemptImage = el<HTMLImageElement>('#attempt-image');
const publishedImage = el<HTMLImageElement>('#published-image');
const attemptEmpty = el<HTMLSpanElement>('#attempt-empty');

let role: Role | null = null;
let phase: SessionMeta['phase'] = 'lobby';
let lastMeta: SessionMeta | null = null;
let scene: SceneHandle | null = null;
let activeHandle: LightHandle = 'bulb';
let tasks: TaskEntry[] = [];
let attempts: Attempt[] = [];
/** The task the novice is currently working on (drives their reference view and submits). */
let activeTaskId: number | null = null;

function chip(text: string, on = false): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = on ? 'chip on' : 'chip';
  span.textContent = text;
  return span;
}

function showApp(): void {
  landing.classList.add('hidden');
  appView.classList.remove('hidden');
  viewport.classList.remove('hidden');
  mountScene();
}

function mountScene(): void {
  if (scene) return;
  scene = createScene(
    sceneMount,
    (camera, light) => {
      if (socket.connected && role) {
        socket.emit('state:update', { camera, light });
      }
    },
    // Only the expert needs the what-the-novice-will-receive preview;
    // visibility is managed by updateSideView.
    role === 'expert' ? previewCanvas : undefined
  );
}

function refreshHandleButtons(): void {
  toggleMoveBtn.classList.toggle('active', activeHandle === 'bulb');
  toggleAimBtn.classList.toggle('active', activeHandle === 'aim');
}

function updateRoleButtons(meta: SessionMeta): void {
  // Expert can publish while in lobby or after the previous round; novice can
  // submit (and resubmit) whenever a task is live.
  publishBtn.classList.toggle('hidden', !(role === 'expert' && meta.phase !== 'task'));
  const taskLive = meta.phase === 'task' || meta.phase === 'submitted';
  submitBtn.classList.toggle('hidden', !(role === 'novice' && taskLive));
}

/** Right-hand slot of the viewport row: expert sees the live preview, novice the selected task's reference. */
function updateSideView(): void {
  previewPanel.classList.toggle('hidden', role !== 'expert');
  const selectedTask = tasks.find((t) => t.id === activeTaskId);
  const showReference = role === 'novice' && selectedTask !== undefined;
  if (showReference && selectedTask) {
    referenceImg.src = selectedTask.referenceImage;
  }
  referenceImg.classList.toggle('hidden', !showReference);
}

/** Student selector above the work area: which published task they are working on. */
function refreshWorkSelect(selectTaskId?: number): void {
  workTaskRow.classList.toggle('hidden', !(role === 'novice' && tasks.length > 0));
  workTaskSelect.replaceChildren(
    ...tasks.map(taskLabelOption)
  );
  const picked = tasks.find((t) => t.id === selectTaskId) ?? tasks[tasks.length - 1];
  if (picked) {
    activeTaskId = picked.id;
    workTaskSelect.value = String(picked.id);
  } else {
    activeTaskId = null;
  }
}

function renderMeta(meta: SessionMeta): void {
  phase = meta.phase;
  lastMeta = meta;
  sessionCode.textContent = meta.code;
  roleTag.textContent = role === 'expert' ? 'Expert' : 'Novice';
  updateRoleButtons(meta);
  updateSideView();

  rolePanel.replaceChildren(
    chip(`Expert ${meta.expertPresent ? 'connected' : 'not connected'}`, meta.expertPresent),
    chip(`Novice ${meta.novicePresent ? 'connected' : 'not connected'}`, meta.novicePresent),
    chip(`Phase: ${meta.phase}${meta.submitted ? ' (attempt submitted)' : ''}`)
  );

  if (role === 'novice' && meta.phase === 'lobby') {
    rolePanel.appendChild(chip('Waiting for the expert to publish a task…'));
  }
  if (role === 'novice' && meta.phase === 'task') {
    rolePanel.appendChild(chip('Match the reference image with your own camera and light.'));
  }
  if (role === 'expert' && meta.phase === 'task') {
    rolePanel.appendChild(chip(meta.novicePresent
      ? 'Task running — the novice is replicating your setup.'
      : 'Waiting for the novice to join.'));
  }
  if (role === 'expert' && meta.phase === 'submitted') {
    rolePanel.appendChild(chip('Novice submitted — compare setups and chat feedback.'));
  }
}

// --- Landing actions --------------------------------------------------------

el<HTMLButtonElement>('#create-btn').addEventListener('click', () => {
  landingError.textContent = '';
  socket.emit('session:create', (meta) => {
    role = 'expert';
    showApp();
    renderMeta(meta);
  });
});

function joinSession(): void {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) {
    landingError.textContent = 'Enter a 5-character session code.';
    return;
  }
  socket.emit('session:join', code, (result) => {
    if (!result.ok || !result.role || !result.meta) {
      landingError.textContent = result.error ?? 'Could not join session.';
      return;
    }
    role = result.role;
    showApp();
    renderMeta(result.meta);
  });
}

el<HTMLButtonElement>('#join-btn').addEventListener('click', joinSession);
codeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinSession();
});
codeInput.addEventListener('input', () => {
  landingError.textContent = '';
});

// Copy the session code to the clipboard for sharing.
copyCodeBtn.addEventListener('click', () => {
  const code = sessionCode.textContent;
  if (code) {
    navigator.clipboard.writeText(code).then(() => {
      copyCodeBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyCodeBtn.textContent = 'Copy';
      }, 1500);
    });
  }
});

// --- Scene controls ---------------------------------------------------------

toggleMoveBtn.addEventListener('click', () => {
  activeHandle = 'bulb';
  scene?.setHandle('bulb');
  refreshHandleButtons();
});
toggleAimBtn.addEventListener('click', () => {
  activeHandle = 'aim';
  scene?.setHandle('aim');
  refreshHandleButtons();
});
resetCameraBtn.addEventListener('click', () => scene?.resetCamera());
resetLightBtn.addEventListener('click', () => scene?.resetLight());
refreshHandleButtons();

document.querySelectorAll<HTMLInputElement>('input[name="intensity"]').forEach((input) => {
  input.addEventListener('change', () => {
    scene?.setIntensityPreset(input.value as IntensityPreset);
  });
});

publishBtn.addEventListener('click', () => {
  if (role !== 'expert' || !scene) return;
  scene
    .captureReference()
    .then((referenceImage) => {
      const { camera, light } = scene!.state();
      socket.emit('task:publish', { camera, light, referenceImage });
    })
    .catch((err) => console.error('reference capture failed', err));
});

submitBtn.addEventListener('click', () => {
  if (role !== 'novice' || !scene) return;
  if (activeTaskId === null) return;
  const { camera, light } = scene.state();
  const taskId = activeTaskId;
  scene
    .captureReference()
    .then((image) => socket.emit('attempt:submit', { taskId, camera, light, image }))
    .catch((err) => console.error('attempt capture failed', err));
});

// --- Published tasks & submissions -----------------------------------------

function taskLabel(task: TaskEntry): string {
  return `Task ${task.id} — ${new Date(task.createdAt).toLocaleTimeString()}`;
}

function taskLabelOption(task: TaskEntry): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = String(task.id);
  option.textContent = taskLabel(task);
  return option;
}

function attemptLabel(attempt: Attempt): string {
  return `Attempt ${attempt.id} — ${new Date(attempt.createdAt).toLocaleTimeString()}`;
}

function showAttempt(attempt: Attempt | undefined): void {
  if (!attempt) {
    attemptImage.classList.add('hidden');
    attemptImage.removeAttribute('src');
    return;
  }
  attemptImage.src = attempt.image;
  attemptImage.classList.remove('hidden');
}

function refreshTasksUi(selectTaskId?: number): void {
  tasks.sort((a, b) => a.id - b.id);
  taskSelect.replaceChildren(...tasks.map(taskLabelOption));
  const picked = tasks.find((t) => t.id === selectTaskId) ?? tasks[tasks.length - 1];
  if (picked) {
    taskSelect.value = String(picked.id);
    publishedImage.src = picked.referenceImage;
    publishedImage.classList.remove('hidden');
  } else {
    publishedImage.classList.add('hidden');
    publishedImage.removeAttribute('src');
  }
  refreshAttemptOptions(picked?.id);
  attemptsPanel.classList.toggle('hidden', tasks.length === 0);
  // Student's working selection follows newly published tasks by default.
  refreshWorkSelect(picked?.id);
  if (role === 'novice') updateSideView();
}

function refreshAttemptOptions(taskId: number | undefined): void {
  const forTask = attempts.filter((a) => taskId !== undefined && a.taskId === taskId);
  attemptSelect.replaceChildren(
    ...forTask.map((attempt) => {
      const option = document.createElement('option');
      option.value = String(attempt.id);
      option.textContent = attemptLabel(attempt);
      return option;
    })
  );
  const newest = forTask[forTask.length - 1];
  if (newest) {
    attemptSelect.value = String(newest.id);
    showAttempt(newest);
    attemptEmpty.classList.add('hidden');
  } else {
    showAttempt(undefined);
    attemptSelect.value = '';
    attemptEmpty.classList.remove('hidden');
  }
}

function clearTaskUi(): void {
  tasks = [];
  attempts = [];
  activeTaskId = null;
  taskSelect.replaceChildren();
  attemptSelect.replaceChildren();
  workTaskSelect.replaceChildren();
  workTaskRow.classList.add('hidden');
  showAttempt(undefined);
  publishedImage.classList.add('hidden');
  publishedImage.removeAttribute('src');
  attemptEmpty.classList.remove('hidden');
  attemptsPanel.classList.add('hidden');
}

taskSelect.addEventListener('change', () => {
  refreshAttemptOptions(Number(taskSelect.value));
});

attemptSelect.addEventListener('change', () => {
  showAttempt(attempts.find((a) => a.id === Number(attemptSelect.value)));
});

workTaskSelect.addEventListener('change', () => {
  activeTaskId = Number(workTaskSelect.value);
  updateSideView();
});

leaveBtn.addEventListener('click', () => {
  // Tell the server to free our role slot synchronously (no reconnect race).
  socket.emit('session:leave');
  role = null;
  phase = 'lobby';
  lastMeta = null;
  clearTaskUi();
  referenceImg.removeAttribute('src');
  referenceImg.classList.add('hidden');
  rolePanel.replaceChildren();
  previewPanel.classList.add('hidden');
  sessionCode.textContent = '';
  landingError.textContent = '';
  appView.classList.add('hidden');
  viewport.classList.add('hidden');
  landing.classList.remove('hidden');
});

// --- Server events ----------------------------------------------------------

socket.on('connect', () => {
  connectionState.textContent = 'connected';
});

socket.on('disconnect', () => {
  connectionState.textContent = 'disconnected — reconnecting…';
});

socket.on('session:meta', (meta) => {
  // Only react while a session is active in this tab.
  if (!landing.classList.contains('hidden')) return;
  renderMeta(meta);
});

socket.on('task:start', () => {
  // The novice's reference view is driven by their selected task;
  // a session:meta tick follows for the phase chips.
  if (lastMeta) updateSideView();
});

socket.on('task:published', (task) => {
  // Add to history (first arrival for a publish), select the new task; its
  // submission list starts empty.
  tasks = tasks.filter((t) => t.id !== task.id).concat(task);
  refreshTasksUi(task.id);
});

socket.on('attempt:submitted', () => {
  // session:meta reports the phase; attempt:saved carries the snapshot.
});

socket.on('attempt:saved', (attempt) => {
  attempts = attempts.filter((a) => a.id !== attempt.id).concat(attempt);
  if (Number(taskSelect.value) === attempt.taskId) {
    refreshAttemptOptions(attempt.taskId);
  }
});

socket.on('tasks:current', (saved) => {
  tasks = [...saved];
  refreshTasksUi();
});

socket.on('attempts:current', (saved) => {
  attempts = [...saved];
  refreshAttemptOptions(Number(taskSelect.value) || undefined);
});

socket.on('peer:update', () => {
  // Live side-by-side rendering arrives in build step 4.
});

socket.on('chat:message', () => {
  // Chat UI arrives in build step 5.
});
