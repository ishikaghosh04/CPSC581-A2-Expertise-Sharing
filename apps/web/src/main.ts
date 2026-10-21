import { io, type Socket } from 'socket.io-client';

import { DEFAULT_TOLERANCES, INTENSITY_PRESETS } from '@expertise-sharing/shared';
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
import {
  HandGestureController,
  type CameraRunState,
  type FingertipPosition,
  type HandPreference,
} from './inputs/hand-tracking.js';
import { VoiceCommandController, type VoiceRunState } from './inputs/voice-commands.js';
import { createHeadTracker } from './headTracking.js';

const CODE_LENGTH = 5;

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

function el<T extends HTMLElement>(sel: string): T {
  const node = document.querySelector(sel);
  if (!node) throw new Error(`Element not found: ${sel}`);
  return node as T;
}

type Theme = 'day' | 'night';

const themeToggle = el<HTMLButtonElement>('#theme-toggle');
const themeModeLabel = el<HTMLSpanElement>('#theme-mode-label');
const themeStorageKey = 'lighting-teacher-theme';

function applyTheme(theme: Theme, persist: boolean): void {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute('aria-checked', String(theme === 'night'));
  themeModeLabel.textContent = theme === 'day' ? 'Day' : 'Night';

  if (persist) {
    drawVoiceActivity();
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch (error) {
      console.error('Could not save the selected theme.', error);
    }
  }
}

function loadThemePreference(): Theme {
  try {
    const savedTheme = window.localStorage.getItem(themeStorageKey);
    if (savedTheme === 'day' || savedTheme === 'night') return savedTheme;
  } catch (error) {
    console.error('Could not read the saved theme preference.', error);
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
}

applyTheme(loadThemePreference(), false);
themeToggle.addEventListener('click', () => {
  const nextTheme: Theme = document.documentElement.dataset.theme === 'day'
    ? 'night'
    : 'day';
  applyTheme(nextTheme, true);
});

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
const headTrackingInstruction = el<HTMLParagraphElement>('#head-tracking-instruction');
const selectedIntensity = el<HTMLParagraphElement>('#selected-intensity');
const intensityButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-intensity]')
);
const startCameraBtn = el<HTMLButtonElement>('#start-camera');
const stopCameraBtn = el<HTMLButtonElement>('#stop-camera');
const handSelection = el<HTMLSelectElement>('#hand-selection');
const handCamera = el<HTMLVideoElement>('#hand-camera');
const handVideoFrame = el<HTMLDivElement>('#hand-video-frame');
const trackingModeIndicator = el<HTMLSpanElement>('#tracking-mode-indicator');
const fingertipOverlay = el<HTMLCanvasElement>('#hand-fingertip-overlay');
const handStatus = el<HTMLParagraphElement>('#hand-status');
const trackingPreview = el<HTMLElement>('.tracking-preview');
const gestureCamera = el<HTMLDivElement>('.gesture-camera');
const gestureProgress = el<HTMLProgressElement>('#gesture-hold-progress');
const gestureProgressLabel = el<HTMLSpanElement>('#gesture-progress-label');
const gestureCountIndicator = el<HTMLParagraphElement>('#gesture-count-indicator');
const cameraState = el<HTMLParagraphElement>('#hand-camera-state');
const cameraPreviewToggle = el<HTMLButtonElement>('#toggle-camera-preview');
const microphoneBtn = el<HTMLButtonElement>('#toggle-microphone');
const microphoneState = el<HTMLParagraphElement>('#microphone-state');
const voiceMeter = el<HTMLDivElement>('#voice-meter');
const voiceActivityCanvas = el<HTMLCanvasElement>('#voice-activity-canvas');
const voiceMeterState = el<HTMLParagraphElement>('#voice-meter-state');
const voiceStatus = el<HTMLParagraphElement>('#voice-status');
const inputTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const inputTabPanels = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
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
const chatPanel = el<HTMLElement>('#chat-panel');
const chatToggle = el<HTMLButtonElement>('#chat-toggle');
const chatForm = el<HTMLFormElement>('#chat-form');
const chatInput = el<HTMLInputElement>('#chat-input');
const chatError = el<HTMLParagraphElement>('#chat-error');
const feedbackSuggestions = el<HTMLElement>('#feedback-suggestions');
const suggestionButtons = el<HTMLDivElement>('#suggestion-buttons');
const diffPanel = el<HTMLElement>('#diff-panel');
const diffSummary = el<HTMLUListElement>('#diff-summary');

function setChatOpen(open: boolean): void {
  chatPanel.hidden = !open;
  chatToggle.setAttribute('aria-expanded', String(open));
  chatToggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} session chat`);
  if (open) chatInput.focus();
}

let role: Role | null = null;
let phase: SessionMeta['phase'] = 'lobby';
let lastMeta: SessionMeta | null = null;
let scene: SceneHandle | null = null;
let selectedIntensityPreset: IntensityPreset = 'medium';
type InputMode = 'manual' | 'hand' | 'voice';
let selectedInputMode: InputMode = 'manual';
let handController: HandGestureController | null = null;
let voiceController: VoiceCommandController | null = null;
let voiceRunState: VoiceRunState = 'off';
const voiceAudioLevels = Array.from({ length: 48 }, () => 0);
let handTrackingEnabled = false;
let handStarting = false;
let cameraRunState: CameraRunState = 'off';
let cameraStatusMessage = 'Camera off · Tracking inactive';
let cameraStream: MediaStream | null = null;
let cameraStartPromise: Promise<void> | null = null;
let cameraRequestId = 0;
let headStarting = false;
let headTrackingRequestId = 0;
let previewMinimized = false;
let lastFingertips: FingertipPosition[] = [];

socket.on('phone:orientation', ({ targetRole, x, y, z }) => {
  if (role !== targetRole || !scene) return;
  scene.setPhoneAim(x, y, z);
});

const headTracker = createHeadTracker(handCamera, ({ x, y }) => {
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
let publishButtonState: 'ready' | 'publishing' | 'published' | 'error' = 'ready';

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
  setPublishButtonState('publishing');
  setActionStatus('Publishing task…');
  scene
    .captureReference()
    .then((referenceImage) => {
      const { camera, light } = scene!.state();
      socket.emit('task:publish', { camera, light, referenceImage });
    })
    .catch((err: unknown) => {
      console.error('reference capture failed', err);
      setPublishButtonState('error');
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
  scene.setIntensityPreset(selectedIntensityPreset);
}

function setIntensity(preset: IntensityPreset, source: InputMode): void {
  if (source !== selectedInputMode) return;
  applyIntensityPreset(preset);
}

function applyIntensityPreset(preset: IntensityPreset): void {
  selectedIntensityPreset = preset;
  scene?.setIntensityPreset(preset);
  const intensity = INTENSITY_PRESETS[preset];
  const lowMediumThreshold = (INTENSITY_PRESETS.low + INTENSITY_PRESETS.medium) / 2;
  const mediumHighThreshold = (INTENSITY_PRESETS.medium + INTENSITY_PRESETS.high) / 2;
  const level: IntensityPreset = intensity < lowMediumThreshold
    ? 'low'
    : intensity < mediumHighThreshold
      ? 'medium'
      : 'high';
  for (const button of intensityButtons) {
    const selected = button.dataset.intensity === preset;
    button.setAttribute('aria-pressed', String(selected));
  }
  selectedIntensity.dataset.level = level;
  selectedIntensity.textContent = `${level.charAt(0).toUpperCase()}${level.slice(1)} intensity`;
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera permission was denied. Allow camera access in browser settings, then try again.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'No camera was found. Connect a camera and try again.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'The camera is already in use or unavailable. Close other camera apps and try again.';
    }
  }
  return 'Could not start the camera. Check browser permissions and try again.';
}

async function ensureSharedCamera(): Promise<void> {
  if (cameraStream?.getVideoTracks().some((track) => track.readyState === 'live')) return;
  if (cameraStartPromise) return cameraStartPromise;
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('Camera access is unavailable. Use a supported browser on HTTPS or localhost.');
    cameraRunState = 'error';
    cameraStatusMessage = error.message;
    updateHandButtons();
    throw error;
  }

  const requestId = ++cameraRequestId;
  cameraRunState = 'starting';
  cameraStatusMessage = 'Requesting camera permission…';
  updateHandButtons();

  const pending = (async (): Promise<void> => {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (requestId !== cameraRequestId) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Camera start was cancelled.');
      }

      handCamera.srcObject = stream;
      await handCamera.play();
      if (requestId !== cameraRequestId) {
        stream.getTracks().forEach((track) => track.stop());
        handCamera.pause();
        handCamera.srcObject = null;
        throw new Error('Camera start was cancelled.');
      }

      cameraStream = stream;
      cameraRunState = 'running';
      cameraStatusMessage = 'Camera is on.';
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (stream && handCamera.srcObject === stream) {
        handCamera.pause();
        handCamera.srcObject = null;
      }
      if (requestId === cameraRequestId) {
        cameraRunState = 'error';
        cameraStatusMessage = cameraErrorMessage(error);
      }
      throw error;
    } finally {
      updateHandButtons();
    }
  })();
  cameraStartPromise = pending;
  try {
    await pending;
  } finally {
    if (cameraStartPromise === pending) cameraStartPromise = null;
  }
}

function releaseCameraIfUnused(): void {
  if (handTrackingEnabled || headTrackingEnabled) return;
  if (cameraStartPromise) cameraRequestId += 1;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  handCamera.pause();
  handCamera.srcObject = null;
  if (cameraRunState !== 'error') {
    cameraRunState = 'off';
    cameraStatusMessage = 'Camera off · Tracking inactive';
  }
  updateHandButtons();
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.matches('input, textarea, select'));
}

function drawFingertipDots(points: FingertipPosition[]): void {
  const context = fingertipOverlay.getContext('2d');
  if (!context) return;

  const { width, height } = handVideoFrame.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  fingertipOverlay.width = Math.round(width * pixelRatio);
  fingertipOverlay.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const videoWidth = handCamera.videoWidth;
  const videoHeight = handCamera.videoHeight;
  if (width === 0 || height === 0 || videoWidth === 0 || videoHeight === 0) return;

  const coverScale = Math.max(width / videoWidth, height / videoHeight);
  const renderedWidth = videoWidth * coverScale;
  const renderedHeight = videoHeight * coverScale;
  const cropX = (renderedWidth - width) / 2;
  const cropY = (renderedHeight - height) / 2;
  const radius = Math.max(5, Math.min(width, height) * 0.045);

  for (const point of points) {
    // The video is mirrored in CSS; mirror the landmark's x coordinate in the overlay too.
    const sourceX = point.x * renderedWidth - cropX;
    const x = width - sourceX;
    const y = point.y * renderedHeight - cropY;
    if (x < -radius || x > width + radius || y < -radius || y > height + radius) continue;

    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = '#8fffc2';
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = '#10131a';
    context.stroke();
    context.beginPath();
    context.arc(x, y, radius + 2, 0, Math.PI * 2);
    context.lineWidth = 1.5;
    context.strokeStyle = '#f7fff9';
    context.stroke();
  }
}

function updateHandButtons(): void {
  const cameraIsOn = cameraStream !== null;
  const anyTrackingActive = handTrackingEnabled || headTrackingEnabled;
  const cameraIsStarting = cameraRunState === 'starting' || handStarting || headStarting;
  startCameraBtn.disabled = cameraIsStarting;
  startCameraBtn.textContent = handStarting
    ? 'Starting hand tracking…'
    : handTrackingEnabled
      ? 'Disable hand tracking'
      : 'Enable hand tracking';
  startCameraBtn.dataset.state = handTrackingEnabled ? 'running' : 'idle';
  startCameraBtn.setAttribute('aria-pressed', String(handTrackingEnabled));
  stopCameraBtn.disabled = !cameraIsOn && !anyTrackingActive && !cameraIsStarting;
  headTrackingBtn.disabled = headStarting;
  headTrackingBtn.textContent = headTrackingEnabled
    ? 'Disable head tracking'
    : 'Enable head tracking';
  headTrackingBtn.setAttribute('aria-pressed', String(headTrackingEnabled));
  headTrackingBtn.dataset.active = String(headTrackingEnabled);
  headTrackingInstruction.hidden = !headTrackingEnabled;
  gestureCamera.hidden = !cameraIsOn;
  cameraPreviewToggle.hidden = !cameraIsOn;
  cameraPreviewToggle.setAttribute('aria-expanded', String(!previewMinimized));
  cameraPreviewToggle.textContent = previewMinimized ? 'Show preview' : 'Hide preview';
  handVideoFrame.hidden = previewMinimized || !cameraIsOn;
  handCamera.classList.toggle('hidden', !cameraIsOn);
  fingertipOverlay.classList.toggle('hidden', !cameraIsOn);
  const activeModes = [
    handTrackingEnabled ? 'Hand tracking' : '',
    headTrackingEnabled ? 'Head tracking' : '',
  ].filter(Boolean);
  trackingModeIndicator.textContent = activeModes.join(' + ');
  trackingModeIndicator.hidden = !cameraIsOn || activeModes.length === 0;
  cameraState.textContent = cameraIsStarting
    ? cameraStatusMessage
    : cameraRunState === 'error'
      ? cameraStatusMessage
      : cameraIsOn
        ? `${activeModes.join(' + ') || 'Camera'} active${handTrackingEnabled && selectedInputMode !== 'hand' ? ' · Gesture feedback paused' : ''}`
        : 'Camera off · Tracking inactive';
  cameraState.classList.toggle('is-active', cameraIsOn && anyTrackingActive);
  cameraState.classList.toggle('is-error', cameraRunState === 'error');
  if (!handTrackingEnabled || !cameraIsOn) {
    lastFingertips = [];
    gestureCountIndicator.textContent = '';
    gestureProgress.value = 0;
    gestureProgressLabel.textContent = handStarting || cameraRunState === 'starting'
      ? 'Waiting for camera access…'
      : 'Start hand tracking to enable gestures.';
    if (cameraRunState !== 'error') handStatus.textContent = '';
  } else if (selectedInputMode !== 'hand') {
    lastFingertips = [];
    gestureCountIndicator.textContent = 'Tracking paused';
    gestureProgress.value = 0;
    gestureProgressLabel.textContent = 'Return to Hand gestures to resume.';
    handStatus.textContent = '';
  }
  drawFingertipDots(lastFingertips);
}

function renderGestureFeedback(
  hand: 'Left' | 'Right' | null,
  fingers: number,
  fingertips: FingertipPosition[],
  hold: number,
  applied: boolean,
  state: 'none' | 'unsupported' | 'supported'
): void {
  if (selectedInputMode !== 'hand' || !handTrackingEnabled || !cameraStream) return;
  lastFingertips = fingertips;
  drawFingertipDots(lastFingertips);
  gestureProgress.value = hold;

  if (state === 'none') {
    handStatus.textContent = 'No hand detected.';
    gestureCountIndicator.textContent = 'No fingers detected';
    gestureProgressLabel.textContent = 'Hold a gesture steady to select.';
    return;
  }

  const countLabel = `${fingers} ${fingers === 1 ? 'finger' : 'fingers'} detected`;
  gestureCountIndicator.textContent = `${Array.from({ length: fingers }, () => '●').join(' ')}${fingers ? ' — ' : ''}${countLabel}`;

  if (state === 'unsupported') {
    handStatus.textContent = 'Raise 1, 2, or 3 fingers.';
    gestureProgress.value = 0;
    gestureProgressLabel.textContent = 'Unsupported gesture';
    return;
  }

  const brightness = fingers === 1 ? 'Low' : fingers === 2 ? 'Medium' : 'High';
  handStatus.textContent = applied
    ? `${brightness} brightness applied.`
    : `${countLabel} → Hold for ${brightness}.`;
  gestureProgressLabel.textContent = applied
    ? `${hand} hand · gesture selected`
    : 'Hold steady to apply';
}

const handVideoResizeObserver = new ResizeObserver(() => {
  drawFingertipDots(lastFingertips);
});
handVideoResizeObserver.observe(handVideoFrame);

function setPublishButtonState(state: typeof publishButtonState): void {
  publishButtonState = state;
  const labels: Record<typeof publishButtonState, string> = {
    ready: 'Publish now',
    publishing: 'Publishing…',
    published: 'Published ✓',
    error: 'Publish now',
  };
  publishBtn.textContent = labels[state];
  publishBtn.disabled = state === 'publishing';
  publishBtn.dataset.state = state;
}

function setVoiceButtonState(): void {
  const active = voiceRunState === 'listening' || voiceRunState === 'listening-unmetered';
  microphoneBtn.textContent = active ? 'Disable microphone' : 'Enable microphone';
  microphoneBtn.disabled = voiceRunState === 'starting';
  microphoneBtn.setAttribute('aria-pressed', String(active));
  microphoneBtn.dataset.active = String(active);
  microphoneState.textContent = voiceRunState === 'listening'
    ? 'Listening'
    : voiceRunState === 'listening-unmetered'
      ? 'Listening · level unavailable'
      : voiceRunState === 'starting'
        ? 'Requesting microphone access…'
        : voiceRunState === 'error'
          ? 'Microphone error'
          : 'Microphone off';
  microphoneState.classList.toggle('is-active', active);
  microphoneState.classList.toggle('is-error', voiceRunState === 'error');
  voiceStatus.classList.toggle('is-error', voiceRunState === 'error');
  voiceMeter.dataset.state = voiceRunState;
  voiceMeterState.textContent = voiceRunState === 'listening'
    ? 'Listening · speak to see activity'
    : voiceRunState === 'listening-unmetered'
      ? 'Live audio level is unavailable in this browser.'
      : voiceRunState === 'starting'
        ? 'Waiting for microphone permission…'
        : voiceRunState === 'error'
          ? 'Microphone unavailable'
          : 'Microphone off';
}

function drawVoiceActivity(level?: number | null): void {
  const context = voiceActivityCanvas.getContext('2d');
  if (!context) return;

  if (level === null) {
    voiceAudioLevels.fill(0);
  } else if (level !== undefined) {
    voiceAudioLevels.push(level);
    voiceAudioLevels.shift();
  }

  const rect = voiceActivityCanvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (voiceActivityCanvas.width !== width || voiceActivityCanvas.height !== height) {
    voiceActivityCanvas.width = width;
    voiceActivityCanvas.height = height;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const midY = rect.height / 2;
  context.beginPath();
  voiceAudioLevels.forEach((sample, index) => {
    const x = (index / (voiceAudioLevels.length - 1)) * rect.width;
    const amplitude = sample === 0 ? 0 : Math.min(sample * 5, 0.9) * rect.height * 0.46;
    const y = midY - amplitude;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  const dayTheme = document.documentElement.dataset.theme === 'day';
  context.strokeStyle = voiceRunState === 'listening'
    ? dayTheme ? '#216b3e' : '#7ce3a2'
    : dayTheme ? '#6b7280' : '#647080';
  context.shadowColor = voiceRunState === 'listening'
    ? dayTheme ? 'rgba(33, 107, 62, 0.35)' : 'rgba(124, 227, 162, 0.55)'
    : 'transparent';
  context.shadowBlur = voiceRunState === 'listening' ? 5 : 0;
  context.stroke();
  context.shadowBlur = 0;
}

function initializeInputControllers(): void {
  handController = new HandGestureController(
    handCamera,
    (message, state) => {
      cameraStatusMessage = message;
      if (state === 'error') {
        cameraRunState = 'error';
        handTrackingEnabled = false;
        handController?.setEnabled(false);
        releaseCameraIfUnused();
      } else if (state === 'running') {
        cameraRunState = cameraStream ? 'running' : 'off';
      } else if (state === 'starting') {
        cameraRunState = cameraStream ? 'running' : 'starting';
      } else {
        cameraRunState = cameraStream ? 'running' : 'off';
      }
      if (state === 'error') handStatus.textContent = message;
      handStatus.classList.toggle('is-error', state === 'error');
      updateHandButtons();
    },
    (feedback) => renderGestureFeedback(
      feedback.hand,
      feedback.fingers,
      feedback.fingertips,
      feedback.holdProgress,
      feedback.applied,
      feedback.state
    ),
    (fingers) => {
      const preset: IntensityPreset = fingers === 1 ? 'low' : fingers === 2 ? 'medium' : 'high';
      setIntensity(preset, 'hand');
    }
  );
  voiceController = new VoiceCommandController(
    (message, state) => {
      voiceRunState = state;
      voiceStatus.textContent = message;
      setVoiceButtonState();
      drawVoiceActivity(state === 'listening' ? 0 : null);
    },
    (preset) => setIntensity(preset, 'voice'),
    drawVoiceActivity
  );
  handController.setPreference(handSelection.value as HandPreference);
  handController.setEnabled(selectedInputMode === 'hand' && handTrackingEnabled);
}

function selectInputTab(tab: HTMLButtonElement, focus = false): void {
  const panelId = tab.getAttribute('aria-controls');
  const nextMode: InputMode = panelId === 'panel-hand'
    ? 'hand'
    : panelId === 'panel-voice'
      ? 'voice'
      : 'manual';
  if (selectedInputMode !== nextMode) {
    selectedInputMode = nextMode;
    handController?.setEnabled(nextMode === 'hand' && handTrackingEnabled);
    if (nextMode !== 'hand') {
      lastFingertips = [];
      drawFingertipDots([]);
      gestureProgress.value = 0;
      handStatus.textContent = '';
      gestureCountIndicator.textContent = cameraRunState === 'running'
        ? 'Tracking paused'
        : '';
      gestureProgressLabel.textContent = cameraRunState === 'running'
        ? 'Return to Hand gestures to resume.'
        : 'Start the camera to enable tracking.';
    }
    if (nextMode !== 'voice') voiceController?.stop();
    updateHandButtons();
  }
  for (const item of inputTabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  }
  for (const panel of inputTabPanels) panel.hidden = panel.id !== panelId;
  if (focus) tab.focus();
}

async function startHandTracking(): Promise<void> {
  if (handTrackingEnabled || handStarting) return;
  if (!handController) initializeInputControllers();
  handStarting = true;
  cameraRunState = cameraStream ? 'running' : 'starting';
  cameraStatusMessage = 'Starting hand tracking…';
  handStatus.textContent = '';
  handStatus.classList.remove('is-error');
  updateHandButtons();
  try {
    await ensureSharedCamera();
    handTrackingEnabled = true;
    handController?.setEnabled(selectedInputMode === 'hand');
    await handController?.start();
  } catch (error) {
    if (!(error instanceof Error && error.message === 'Camera start was cancelled.')) {
      handTrackingEnabled = false;
      if (cameraStream) {
        cameraRunState = 'error';
        cameraStatusMessage = error instanceof Error
          ? error.message
          : 'Could not start hand tracking.';
      }
    }
    releaseCameraIfUnused();
  } finally {
    handStarting = false;
    updateHandButtons();
  }
}

function stopHandTracking(): void {
  handController?.stop();
  handTrackingEnabled = false;
  handStarting = false;
  releaseCameraIfUnused();
  updateHandButtons();
}

function stopAllTracking(): void {
  headTrackingRequestId += 1;
  handController?.stop();
  headTracker.stop();
  handTrackingEnabled = false;
  headTrackingEnabled = false;
  handStarting = false;
  headStarting = false;
  releaseCameraIfUnused();
  cameraRunState = 'off';
  cameraStatusMessage = 'Camera off · Tracking inactive';
  updateHandButtons();
}

function refreshHandleButtons(): void {
  toggleMoveBtn.classList.toggle('active', activeHandle === 'bulb');
  toggleAimBtn.classList.toggle('active', activeHandle === 'aim');
}

function updateRoleButtons(meta: SessionMeta): void {
  // Expert can publish while in lobby or after the previous round; novice can
  // submit (and resubmit) whenever a task is live.
  const canPublish = role === 'expert' && meta.phase !== 'task';
  publishBtn.classList.toggle('hidden', !canPublish);
  if (canPublish && publishButtonState === 'published') setPublishButtonState('ready');
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
resetLightBtn.addEventListener('click', () => {
  scene?.resetLight();
  applyIntensityPreset('medium');
});
headTrackingBtn.addEventListener('click', async () => {
  if (headTrackingEnabled) {
    headTrackingRequestId += 1;
    headTracker.stop();
    headTrackingEnabled = false;
    releaseCameraIfUnused();
    updateHandButtons();
    return;
  }

  if (!scene) {
    cameraRunState = 'error';
    cameraStatusMessage = 'Join or create a session before enabling head tracking.';
    updateHandButtons();
    return;
  }

  headStarting = true;
  const requestId = ++headTrackingRequestId;
  cameraRunState = cameraStream ? 'running' : 'starting';
  cameraStatusMessage = 'Starting head tracking…';
  updateHandButtons();
  try {
    await ensureSharedCamera();
    if (requestId !== headTrackingRequestId) return;
    await headTracker.start();
    if (requestId !== headTrackingRequestId) return;
    headTrackingEnabled = true;
  } catch (error) {
    console.error('Head tracking failed:', error);
    if (requestId !== headTrackingRequestId) return;
    headTrackingEnabled = false;
    if (cameraStream) {
      cameraRunState = 'error';
      cameraStatusMessage = error instanceof Error
        ? `Could not start head tracking: ${error.message}`
        : 'Could not start head tracking. Check camera permissions and try again.';
    }
    releaseCameraIfUnused();
  } finally {
    headStarting = false;
    updateHandButtons();
  }
});

refreshHandleButtons();

intensityButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (selectedInputMode !== 'manual') return;
    const preset = button.dataset.intensity;
    if (preset === 'low' || preset === 'medium' || preset === 'high') {
      setIntensity(preset, 'manual');
    }
  });
});
document.addEventListener('keydown', (event) => {
  if (
    selectedInputMode !== 'manual'
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || isTypingTarget(event.target)
  ) return;
  const preset = event.key === '1' ? 'low' : event.key === '2' ? 'medium' : event.key === '3' ? 'high' : null;
  if (!preset) return;
  event.preventDefault();
  setIntensity(preset, 'manual');
});
startCameraBtn.addEventListener('click', () => {
  if (handTrackingEnabled) stopHandTracking();
  else void startHandTracking();
});
stopCameraBtn.addEventListener('click', stopAllTracking);
handSelection.addEventListener('change', () => {
  handController?.setPreference(handSelection.value as HandPreference);
});
cameraPreviewToggle.addEventListener('click', () => {
  previewMinimized = !previewMinimized;
  trackingPreview.classList.toggle('preview-minimized', previewMinimized);
  updateHandButtons();
});
for (const tab of inputTabs) {
  tab.addEventListener('click', () => selectInputTab(tab));
  tab.addEventListener('keydown', (event) => {
    const index = inputTabs.indexOf(tab);
    const nextIndex = event.key === 'ArrowRight'
      ? (index + 1) % inputTabs.length
      : event.key === 'ArrowLeft'
        ? (index - 1 + inputTabs.length) % inputTabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? inputTabs.length - 1
        : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = inputTabs[nextIndex];
    if (nextTab) selectInputTab(nextTab, true);
  });
}
microphoneBtn.addEventListener('click', () => {
  if (!voiceController) initializeInputControllers();
  if (voiceController?.isActive) voiceController.stop();
  else voiceController?.start();
  setVoiceButtonState();
});
initializeInputControllers();
updateHandButtons();
setVoiceButtonState();
drawVoiceActivity(null);
setIntensity(selectedIntensityPreset, 'manual');
setPublishButtonState('ready');

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

chatToggle.addEventListener('click', () => {
  setChatOpen(chatPanel.hidden);
});

chatPanel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !chatPanel.hidden) {
    event.preventDefault();
    setChatOpen(false);
    chatToggle.focus();
  }
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
  stopAllTracking();
  // Tell the server to free our role slot synchronously (no reconnect race).
  socket.emit('session:leave');
  voiceController?.stop();
  updateHandButtons();
  setVoiceButtonState();
  role = null;
  phase = 'lobby';
  lastMeta = null;
  chatPanel.hidden = true;
  chatToggle.setAttribute('aria-expanded', 'false');
  chatToggle.setAttribute('aria-label', 'Open session chat');
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
    setPublishButtonState('published');
    setActionStatus('Task published successfully.', 'success');
    publishStatusTimeout = window.setTimeout(() => {
      if (actionStatus.textContent === 'Task published successfully.') {
        setActionStatus('');
      }
      setPublishButtonState('ready');
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
