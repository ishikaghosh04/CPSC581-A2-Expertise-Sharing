import { io, type Socket } from 'socket.io-client';

import { DEFAULT_TOLERANCES } from '@expertise-sharing/shared';
import type {
  Attempt,
  AttemptFeedback,
  AttemptReview,
  AudioFeedbackAttribute,
  ChatMessage,
  ClientToServerEvents,
  IntensityPreset,
  Role,
  ServerToClientEvents,
  SessionMeta,
  StateSnapshot,
  TaskEntry,
} from '@expertise-sharing/shared';

import { createScene, type LightHandle, type SceneHandle } from './scene.js';
import { createHeadTracker } from './headTracking.js';

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
const headTrackingBtn = el<HTMLButtonElement>('#toggle-head-tracking');
const previewPanel = el<HTMLElement>('#preview');
const previewCanvas = el<HTMLCanvasElement>('#preview-canvas');
const publishBtn = el<HTMLButtonElement>('#publish-btn');
const submitBtn = el<HTMLButtonElement>('#submit-btn');
const actionStatus = el<HTMLParagraphElement>('#action-status');
const actionConfirmDialog = el<HTMLDialogElement>('#action-confirm-dialog');
const actionConfirmTitle = el<HTMLHeadingElement>('#action-confirm-title');
const actionConfirmMessage = el<HTMLParagraphElement>('#action-confirm-message');
const actionConfirmButton = el<HTMLButtonElement>('#action-confirm-button');
const attemptsPanel = el<HTMLElement>('#attempts');
const feedbackNotice = el<HTMLDivElement>('#feedback-notice');
const feedbackNoticeButton = el<HTMLButtonElement>('#feedback-notice-button');
const workTaskRow = el<HTMLElement>('#work-task-row');
const workTaskSelect = el<HTMLSelectElement>('#work-task');
const taskSelect = el<HTMLSelectElement>('#task-select');
const attemptSelect = el<HTMLSelectElement>('#attempt-select');
const attemptImage = el<HTMLImageElement>('#attempt-image');
const publishedImage = el<HTMLImageElement>('#published-image');
const attemptEmpty = el<HTMLSpanElement>('#attempt-empty');
const attemptFeedbackPanel = el<HTMLElement>('#attempt-feedback');
const attemptFeedbackText = el<HTMLParagraphElement>('#attempt-feedback-text');
const attemptFeedbackUnread = el<HTMLSpanElement>('#attempt-feedback-unread');
const attemptFeedbackEditor = el<HTMLElement>('#attempt-feedback-editor');
const attemptFeedbackInput = el<HTMLTextAreaElement>('#attempt-feedback-input');
const sendAttemptFeedbackBtn = el<HTMLButtonElement>('#send-attempt-feedback');
const feedbackStatus = el<HTMLParagraphElement>('#feedback-status');
const hintPanel = el<HTMLElement>('#hint-panel');
const requestHintBtn = el<HTMLButtonElement>('#request-hint');
const hintText = el<HTMLParagraphElement>('#hint-text');
const audioFeedbackStatus = el<HTMLParagraphElement>('#audio-feedback-status');
const audioFeedbackButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-audio-attribute]')
);
const chatMessages = el<HTMLDivElement>('#chat-messages');
const chatForm = el<HTMLFormElement>('#chat-form');
const chatInput = el<HTMLInputElement>('#chat-input');
const chatError = el<HTMLParagraphElement>('#chat-error');
const feedbackSuggestions = el<HTMLElement>('#feedback-suggestions');
const suggestionButtons = el<HTMLDivElement>('#suggestion-buttons');
const diffPanel = el<HTMLElement>('#diff-panel');
const diffSummary = el<HTMLUListElement>('#diff-summary');

let role: Role | null = null;
let phase: SessionMeta['phase'] = 'lobby';
let lastMeta: SessionMeta | null = null;
let scene: SceneHandle | null = null;
const headTracker = createHeadTracker(({ x, y }) => {
  scene?.setHeadOffset(x, y);
});

let headTrackingEnabled = false;
let activeHandle: LightHandle = 'bulb';
let tasks: TaskEntry[] = [];
let attempts: Attempt[] = [];
const reviews = new Map<number, AttemptReview>();
const attemptFeedback = new Map<number, AttemptFeedback>();
/** The task the novice is currently working on (drives their reference view and submits). */
let activeTaskId: number | null = null;
let selectedAudioAttribute: AudioFeedbackAttribute | null = null;
let audioContext: AudioContext | null = null;
let audioUnavailable = false;
let lastAudioCueAt = 0;
let pendingSubmissionTaskId: number | null = null;
let pendingConfirmedAction: 'publish' | 'submit' | null = null;
let submittedSnapshot: StateSnapshot | null = null;
let publishStatusTimeout: number | null = null;

const AUDIO_FEEDBACK_ATTRIBUTES: Array<{ value: AudioFeedbackAttribute; label: string }> = [
  { value: 'camera-position', label: 'Camera position' },
  { value: 'camera-aim', label: 'Camera aim' },
  { value: 'light-position', label: 'Light position' },
  { value: 'light-aim', label: 'Light aim' },
  { value: 'intensity', label: 'Brightness' },
];

function audioFeedbackLabel(attribute: AudioFeedbackAttribute): string {
  return AUDIO_FEEDBACK_ATTRIBUTES.find((item) => item.value === attribute)?.label
    ?? 'Selected attribute';
}

function syncAudioFeedbackSelection(): void {
  if (role !== 'novice' || !scene) return;
  if (activeTaskId === null || selectedAudioAttribute === null) {
    socket.emit('audio-feedback:select', null);
    return;
  }
  socket.emit('audio-feedback:select', {
    taskId: activeTaskId,
    attribute: selectedAudioAttribute,
    snapshot: scene.state(),
  });
}

function enableAudioFeedback(): void {
  if (typeof AudioContext === 'undefined') {
    audioUnavailable = true;
    audioFeedbackStatus.textContent = 'Audio feedback is not supported in this browser.';
    return;
  }
  audioUnavailable = false;
  audioContext ??= new AudioContext();
  void audioContext.resume().catch((error: unknown) => {
    audioUnavailable = true;
    console.error('could not enable audio feedback', error);
    audioFeedbackStatus.textContent = 'Audio could not be enabled. Check your browser sound settings.';
  });
}

function playTone(
  context: AudioContext,
  startFrequency: number,
  endFrequency: number,
  startTime: number,
  duration: number
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(startFrequency, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startTime + duration);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.08, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

function playProgressCue(enteredTolerance: boolean): void {
  if (!audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  if (enteredTolerance) {
    playTone(audioContext, 660, 880, now, 0.12);
    playTone(audioContext, 880, 1100, now + 0.13, 0.16);
  } else {
    playTone(audioContext, 440, 660, now, 0.16);
  }
}

function refreshFeedbackNotice(): void {
  const unread = role === 'novice'
    ? [...attemptFeedback.values()].filter((feedback) => feedback.unread)
    : [];
  const latest = unread.sort((a, b) => b.createdAt - a.createdAt)[0];
  feedbackNotice.classList.toggle('hidden', latest === undefined);
  if (latest) {
    feedbackNoticeButton.textContent = `Review Attempt ${latest.attemptId}`;
  }
}

function chip(text: string, on = false): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = on ? 'chip on' : 'chip';
  span.textContent = text;
  return span;
}

function setActionStatus(
  message: string,
  status: 'pending' | 'success' | 'error' = 'pending'
): void {
  if (publishStatusTimeout !== null) {
    window.clearTimeout(publishStatusTimeout);
    publishStatusTimeout = null;
  }
  actionStatus.textContent = message;
  actionStatus.dataset.status = message ? status : '';
}

function stateChangedSinceSubmission(snapshot: StateSnapshot): boolean {
  if (!submittedSnapshot) return false;
  const currentValues = [
    snapshot.camera.position.x,
    snapshot.camera.position.y,
    snapshot.camera.position.z,
    snapshot.camera.target.x,
    snapshot.camera.target.y,
    snapshot.camera.target.z,
    snapshot.light.position.x,
    snapshot.light.position.y,
    snapshot.light.position.z,
    snapshot.light.target.x,
    snapshot.light.target.y,
    snapshot.light.target.z,
    snapshot.light.intensity,
  ];
  const submittedValues = [
    submittedSnapshot.camera.position.x,
    submittedSnapshot.camera.position.y,
    submittedSnapshot.camera.position.z,
    submittedSnapshot.camera.target.x,
    submittedSnapshot.camera.target.y,
    submittedSnapshot.camera.target.z,
    submittedSnapshot.light.position.x,
    submittedSnapshot.light.position.y,
    submittedSnapshot.light.position.z,
    submittedSnapshot.light.target.x,
    submittedSnapshot.light.target.y,
    submittedSnapshot.light.target.z,
    submittedSnapshot.light.intensity,
  ];
  return currentValues.some((value, index) => value !== submittedValues[index]);
}

function requestActionConfirmation(action: 'publish' | 'submit'): void {
  pendingConfirmedAction = action;
  if (action === 'publish') {
    actionConfirmTitle.textContent = 'Ready to publish?';
    actionConfirmMessage.textContent = 'This will publish the current camera and lighting setup as a task for the novice.';
    actionConfirmButton.textContent = 'Publish task';
  } else {
    actionConfirmTitle.textContent = 'Ready to submit?';
    actionConfirmMessage.textContent = 'This will submit your current camera and lighting attempt for expert review.';
    actionConfirmButton.textContent = 'Submit attempt';
  }
  actionConfirmDialog.showModal();
}

function publishTask(): void {
  if (role !== 'expert' || !scene) return;
  setActionStatus('Publishing task…');
  scene
    .captureReference()
    .then((referenceImage) => {
      const { camera, light } = scene!.state();
      socket.emit('task:publish', { camera, light, referenceImage });
    })
    .catch((err: unknown) => {
      console.error('reference capture failed', err);
      setActionStatus('Could not publish the task. Please try again.', 'error');
    });
}

function submitAttempt(): void {
  if (role !== 'novice' || !scene || activeTaskId === null) return;
  const { camera, light } = scene.state();
  submittedSnapshot = { camera, light };
  const taskId = activeTaskId;
  pendingSubmissionTaskId = taskId;
  setActionStatus('Submitting attempt…');
  scene
    .captureReference()
    .then((image) => socket.emit('attempt:submit', { taskId, camera, light, image }))
    .catch((err: unknown) => {
      console.error('attempt capture failed', err);
      pendingSubmissionTaskId = null;
      submittedSnapshot = null;
      setActionStatus('Could not submit the attempt. Please try again.', 'error');
    });
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
      if (
        role === 'novice' &&
        actionStatus.dataset.status === 'success' &&
        stateChangedSinceSubmission({ camera, light })
      ) {
        submittedSnapshot = null;
        setActionStatus('');
      }
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
  syncAudioFeedbackSelection();
}

function renderMeta(meta: SessionMeta): void {
  phase = meta.phase;
  lastMeta = meta;
  sessionCode.textContent = meta.code;
  roleTag.textContent = role === 'expert' ? 'Expert' : 'Novice';
  updateRoleButtons(meta);
  hintPanel.classList.toggle('hidden', role !== 'novice');
  diffPanel.classList.toggle('hidden', role !== 'expert');
  feedbackSuggestions.classList.toggle('hidden', role !== 'expert');
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
headTrackingBtn.addEventListener('click', async () => {
  if (headTrackingEnabled) {
    headTracker.stop();
    headTrackingEnabled = false;
    headTrackingBtn.textContent = 'Enable Head Tracking';
    headTrackingBtn.setAttribute('aria-pressed', 'false');
    return;
  }

  if (!scene) {
    alert('Join or create a session first.');
    return;
  }

  headTrackingBtn.disabled = true;
  headTrackingBtn.textContent = 'Starting webcam...';

  try {
    await headTracker.start();
    headTrackingEnabled = true;
    headTrackingBtn.textContent = 'Disable Head Tracking';
    headTrackingBtn.setAttribute('aria-pressed', 'true');
  } catch (error) {
    console.error('Head tracking failed:', error);
    headTrackingEnabled = false;
    headTrackingBtn.textContent = 'Enable Head Tracking';
    alert('Could not start head tracking. Check webcam permissions and the browser console.');
  } finally {
    headTrackingBtn.disabled = false;
  }
});

refreshHandleButtons();

document.querySelectorAll<HTMLInputElement>('input[name="intensity"]').forEach((input) => {
  input.addEventListener('change', () => {
    scene?.setIntensityPreset(input.value as IntensityPreset);
  });
});

publishBtn.addEventListener('click', () => {
  if (role !== 'expert' || !scene) return;
  requestActionConfirmation('publish');
});

submitBtn.addEventListener('click', () => {
  if (role !== 'novice' || !scene) return;
  if (activeTaskId === null) return;
  requestActionConfirmation('submit');
});

actionConfirmDialog.addEventListener('close', () => {
  const action = pendingConfirmedAction;
  pendingConfirmedAction = null;
  if (actionConfirmDialog.returnValue !== 'confirm' || !action) return;
  if (action === 'publish') publishTask();
  else submitAttempt();
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
  const unread = role === 'novice' && attemptFeedback.get(attempt.id)?.unread;
  return `Attempt ${attempt.id} — ${new Date(attempt.createdAt).toLocaleTimeString()}${unread ? ' (New feedback)' : ''}`;
}

function renderAttemptFeedback(attemptId: number | undefined, markRead = false): void {
  const attempt = attempts.find((item) => item.id === attemptId);
  const feedback = attemptId === undefined ? undefined : attemptFeedback.get(attemptId);
  const showFeedback = feedback !== undefined;
  attemptFeedbackPanel.classList.toggle('hidden', !showFeedback);
  attemptFeedbackEditor.classList.toggle('hidden', role !== 'expert' || !attempt);
  attemptFeedbackUnread.classList.toggle('hidden', role !== 'novice' || !feedback?.unread);
  attemptFeedbackText.textContent = feedback?.text ?? '';
  if (role === 'expert' && document.activeElement !== attemptFeedbackInput) {
    attemptFeedbackInput.value = feedback?.text ?? '';
  }
  feedbackStatus.textContent = '';
  sendAttemptFeedbackBtn.disabled = !attempt;

  if (role === 'novice' && markRead && feedback?.unread && attemptId !== undefined && attempt) {
    attemptFeedback.set(attemptId, { ...feedback, unread: false });
    attemptFeedbackUnread.classList.add('hidden');
    refreshAttemptOptionLabels(attempt.taskId);
    refreshFeedbackNotice();
    socket.emit('feedback:read', attemptId);
  }
}

function refreshAttemptOptionLabels(taskId: number): void {
  for (const attempt of attempts.filter((item) => item.taskId === taskId)) {
    const option = Array.from(attemptSelect.options).find(
      (item) => item.value === String(attempt.id)
    );
    if (option) option.textContent = attemptLabel(attempt);
  }
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

function renderReview(attemptId: number | undefined): void {
  const review = attemptId === undefined ? undefined : reviews.get(attemptId);
  diffSummary.replaceChildren();
  suggestionButtons.replaceChildren();
  feedbackSuggestions.classList.toggle('hidden', role !== 'expert' || !review);
  diffPanel.classList.toggle('hidden', role !== 'expert' || !review);
  if (!review) return;

  const rows: Array<[string, number, number, string, number]> = [
    ['Camera position', review.diff.cameraPositionDistance, DEFAULT_TOLERANCES.position, 'units away', 1],
    ['Camera aim point', review.diff.cameraTargetDistance, DEFAULT_TOLERANCES.position, 'units away', 1],
    ['Light position', review.diff.lightPositionDistance, DEFAULT_TOLERANCES.position, 'units away', 1],
    ['Light aim', review.diff.lightAimAngleDegrees, DEFAULT_TOLERANCES.angle, '° off', 1],
    ['Brightness', review.diff.lightIntensityDifference, DEFAULT_TOLERANCES.intensity, 'intensity off', 2],
  ];
  diffSummary.replaceChildren(...rows.map(([label, value, tolerance, unit, precision]) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${label}: `;
    const status = document.createElement('strong');
    status.className = value <= tolerance ? 'diff-value correct' : 'diff-value';
    status.textContent = value <= tolerance
      ? 'Correct'
      : `${value.toFixed(precision)} ${unit}`;
    item.append(name, status);
    return item;
  }));

  for (const suggestion of review.suggestions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-button';
    button.textContent = suggestion;
    button.addEventListener('click', () => {
      chatInput.value = suggestion;
      chatInput.focus();
    });
    suggestionButtons.append(button);
  }
}

function appendChatMessage(message: ChatMessage): void {
  const entry = document.createElement('p');
  entry.className = `chat-message ${message.from}`;
  const sender = document.createElement('strong');
  sender.textContent = `${message.from === 'expert' ? 'Expert' : 'Novice'}: `;
  const content = document.createElement('span');
  content.textContent = message.text;
  entry.append(sender, content);
  chatMessages.append(entry);
  chatMessages.scrollTop = chatMessages.scrollHeight;
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
    renderReview(newest.id);
    renderAttemptFeedback(newest.id);
  } else {
    showAttempt(undefined);
    attemptSelect.value = '';
    attemptEmpty.classList.remove('hidden');
    renderReview(undefined);
    renderAttemptFeedback(undefined);
  }
}

function clearTaskUi(): void {
  tasks = [];
  attempts = [];
  reviews.clear();
  attemptFeedback.clear();
  activeTaskId = null;
  pendingSubmissionTaskId = null;
  submittedSnapshot = null;
  setActionStatus('');
  selectedAudioAttribute = null;
  audioFeedbackButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  audioFeedbackStatus.textContent = 'Select an attribute to hear when it gets closer to the target.';
  syncAudioFeedbackSelection();
  taskSelect.replaceChildren();
  attemptSelect.replaceChildren();
  workTaskSelect.replaceChildren();
  workTaskRow.classList.add('hidden');
  showAttempt(undefined);
  publishedImage.classList.add('hidden');
  publishedImage.removeAttribute('src');
  attemptEmpty.classList.remove('hidden');
  attemptsPanel.classList.add('hidden');
  feedbackNotice.classList.add('hidden');
  diffSummary.replaceChildren();
  suggestionButtons.replaceChildren();
  feedbackSuggestions.classList.add('hidden');
  hintText.textContent = 'Hints are optional.';
  chatMessages.replaceChildren();
  chatError.textContent = '';
}

taskSelect.addEventListener('change', () => {
  refreshAttemptOptions(Number(taskSelect.value));
});

attemptSelect.addEventListener('change', () => {
  const attempt = attempts.find((a) => a.id === Number(attemptSelect.value));
  showAttempt(attempt);
  renderReview(attempt?.id);
  renderAttemptFeedback(attempt?.id, true);
});

feedbackNoticeButton.addEventListener('click', () => {
  const unread = [...attemptFeedback.values()]
    .filter((feedback) => feedback.unread)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const attempt = attempts.find((item) => item.id === unread?.attemptId);
  if (!attempt) return;
  taskSelect.value = String(attempt.taskId);
  refreshAttemptOptions(attempt.taskId);
  attemptSelect.value = String(attempt.id);
  showAttempt(attempt);
  renderReview(attempt.id);
  renderAttemptFeedback(attempt.id, true);
});

sendAttemptFeedbackBtn.addEventListener('click', () => {
  if (role !== 'expert') return;
  const attemptId = Number(attemptSelect.value);
  if (!Number.isSafeInteger(attemptId) || !attempts.some((item) => item.id === attemptId)) {
    feedbackStatus.textContent = 'Select a submission before sending feedback.';
    return;
  }
  const text = attemptFeedbackInput.value.trim();
  if (!text) {
    feedbackStatus.textContent = 'Enter feedback before sending.';
    return;
  }
  feedbackStatus.textContent = 'Sending feedback…';
  socket.emit('feedback:send', { attemptId, text });
});

workTaskSelect.addEventListener('change', () => {
  activeTaskId = Number(workTaskSelect.value);
  hintText.textContent = 'Hints are optional.';
  audioFeedbackStatus.textContent = selectedAudioAttribute
    ? `${audioFeedbackLabel(selectedAudioAttribute)} selected. Adjust it to hear progress cues.`
    : 'Select an attribute to hear when it gets closer to the target.';
  syncAudioFeedbackSelection();
  updateSideView();
});

audioFeedbackButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const attribute = AUDIO_FEEDBACK_ATTRIBUTES.find(
      (item) => item.value === button.dataset.audioAttribute
    )?.value;
    if (!attribute) throw new Error(`Unknown audio feedback attribute: ${button.dataset.audioAttribute}`);
    selectedAudioAttribute = attribute;
    audioFeedbackButtons.forEach((candidate) => {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    });
    enableAudioFeedback();
    if (!audioUnavailable) {
      audioFeedbackStatus.textContent = `${audioFeedbackLabel(attribute)} selected. Adjust it to hear progress cues.`;
    }
    syncAudioFeedbackSelection();
  });
});

requestHintBtn.addEventListener('click', () => {
  if (role !== 'novice' || activeTaskId === null || !scene) return;
  hintText.textContent = 'Finding a hint...';
  socket.emit('hint:request', { taskId: activeTaskId, snapshot: scene.state() });
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  if (text.length > 500) {
    chatError.textContent = 'Messages must be 500 characters or fewer.';
    return;
  }
  chatError.textContent = '';
  socket.emit('chat:message', text);
  chatInput.value = '';
});

leaveBtn.addEventListener('click', () => {
  headTracker.stop();
  headTrackingEnabled = false;
  headTrackingBtn.textContent = 'Enable Head Tracking';
  headTrackingBtn.setAttribute('aria-pressed', 'false');
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

socket.on('task:start', ({ taskId }) => {
  // The novice's reference view is driven by their selected task;
  // a session:meta tick follows for the phase chips.
  if (role === 'novice') {
    activeTaskId = taskId;
    pendingSubmissionTaskId = null;
    setActionStatus('');
    hintText.textContent = 'Hints are optional.';
    syncAudioFeedbackSelection();
  }
  if (lastMeta) updateSideView();
});

socket.on('task:published', (task) => {
  // Add to history (first arrival for a publish), select the new task; its
  // submission list starts empty.
  tasks = tasks.filter((t) => t.id !== task.id).concat(task);
  refreshTasksUi(task.id);
  if (role === 'expert') {
    setActionStatus('Task published successfully.', 'success');
    publishStatusTimeout = window.setTimeout(() => {
      if (actionStatus.textContent === 'Task published successfully.') {
        setActionStatus('');
      }
    }, 4000);
  }
});

socket.on('attempt:submitted', () => {
  // session:meta reports the phase; attempt:saved carries the snapshot.
});

socket.on('attempt:saved', (attempt) => {
  attempts = attempts.filter((a) => a.id !== attempt.id).concat(attempt);
  if (role === 'novice' && pendingSubmissionTaskId === attempt.taskId) {
    pendingSubmissionTaskId = null;
    setActionStatus('Attempt submitted successfully.', 'success');
  }
  if (Number(taskSelect.value) === attempt.taskId) {
    refreshAttemptOptions(attempt.taskId);
  }
});

socket.on('feedback:new', (feedback) => {
  if (role !== 'novice') return;
  attemptFeedback.set(feedback.attemptId, feedback);
  const attempt = attempts.find((item) => item.id === feedback.attemptId);
  if (attempt) refreshAttemptOptionLabels(attempt.taskId);
  refreshFeedbackNotice();
  if (Number(attemptSelect.value) === feedback.attemptId) {
    renderAttemptFeedback(feedback.attemptId, true);
  }
});

socket.on('feedback:current', (saved) => {
  attemptFeedback.clear();
  for (const feedback of saved) {
    attemptFeedback.set(feedback.attemptId, feedback);
  }
  for (const task of tasks) refreshAttemptOptionLabels(task.id);
  refreshFeedbackNotice();
  renderAttemptFeedback(Number(attemptSelect.value) || undefined);
});

socket.on('feedback:saved', (feedback) => {
  if (role !== 'expert') return;
  attemptFeedback.set(feedback.attemptId, feedback);
  if (Number(attemptSelect.value) === feedback.attemptId) {
    renderAttemptFeedback(feedback.attemptId);
  }
  attemptFeedbackInput.value = '';
  feedbackStatus.textContent = `Feedback sent for Attempt ${feedback.attemptId}.`;
});

socket.on('feedback:error', (message) => {
  feedbackStatus.textContent = message;
});

socket.on('attempt:review', (review) => {
  reviews.set(review.attemptId, review);
  if (Number(attemptSelect.value) === review.attemptId) {
    renderReview(review.attemptId);
  }
});

socket.on('hint:result', (hint) => {
  hintText.textContent = hint?.text ?? 'You are within the target tolerances. Nice work.';
});

socket.on('hint:error', (message) => {
  hintText.textContent = message;
});

socket.on('audio-feedback:progress', (progress) => {
  if (
    role !== 'novice' ||
    progress.taskId !== activeTaskId ||
    progress.attribute !== selectedAudioAttribute
  ) return;
  const label = audioFeedbackLabel(progress.attribute);
  audioFeedbackStatus.textContent = audioUnavailable
    ? `${label} is ${progress.withinTolerance ? 'within tolerance' : 'getting closer'}, but audio is unavailable.`
    : progress.withinTolerance
      ? `${label} is within tolerance.`
      : `${label} is getting closer.`;
  if (audioUnavailable) return;
  const now = performance.now();
  if (!progress.enteredTolerance && now - lastAudioCueAt < 350) return;
  playProgressCue(progress.enteredTolerance);
  lastAudioCueAt = now;
});

socket.on('audio-feedback:error', (message) => {
  audioFeedbackStatus.textContent = message;
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

socket.on('chat:message', (message) => {
  appendChatMessage(message);
});

socket.on('chat:error', (message) => {
  chatError.textContent = message;
});
