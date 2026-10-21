/**
 * Wire protocol shared by the web clients and the Socket.IO server.
 * Single source of truth — both sides import these types. Any change to
 * messages must happen here first.
 */

/** Session role. One expert per session, one novice per session. */
export type Role = 'expert' | 'novice';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Camera view as a duble: eye position plus the point it looks at. */
export interface CameraState {
  /** Eye position of the camera. */
  position: Vec3;
  /** Point the camera looks at. */
  target: Vec3;
}

/** Spotlight state: where the bulb is, where it aims, how bright. */
export interface LightState {
  /** Position of the spotlight bulb. */
  position: Vec3;
  /** Point the spotlight aims at. */
  target: Vec3;
  /** Continuous brightness; UI presets (low/medium/high) map onto values below. */
  intensity: number;
}

export const INTENSITY_PRESETS = {
  low: 1.0,
  medium: 2.0,
  high: 3.5,
} as const;

export type IntensityPreset = keyof typeof INTENSITY_PRESETS;

export type SessionPhase = 'lobby' | 'task' | 'submitted';

export interface SessionMeta {
  code: string;
  phase: SessionPhase;
  /** True once the novice has submitted for the current task. */
  submitted: boolean;
  expertPresent: boolean;
  novicePresent: boolean;
}

export interface TaskTarget {
  camera: CameraState;
  light: LightState;
  /** Data URL of the reference render (expert's view, helpers hidden). */
  referenceImage: string;
}

export interface TaskDiff {
  cameraPositionDistance: number;
  cameraTargetDistance: number;
  lightPositionDistance: number;
  lightAimAngleDegrees: number;
  lightIntensityDifference: number;
}

export interface TaskHint {
  component: 'camera-position' | 'camera-aim' | 'light-position' | 'light-aim' | 'intensity';
  text: string;
}

export type AudioFeedbackAttribute = TaskHint['component'];

export interface AudioFeedbackProgress {
  taskId: number;
  attribute: AudioFeedbackAttribute;
  withinTolerance: boolean;
  enteredTolerance: boolean;
}

export interface AttemptReview {
  attemptId: number;
  taskId: number;
  diff: TaskDiff;
  suggestions: string[];
}

export interface AttemptFeedback {
  attemptId: number;
  text: string;
  createdAt: number;
  unread: boolean;
}

export interface JoinResult {
  ok: boolean;
  role?: Role;
  meta?: SessionMeta;
  error?: string;
}

/** Payload sent when a task starts. The target state stays server-side; novices only get the image. */
export interface TaskStart {
  taskId: number;
  /** Data URL of the reference render (expert's view, light source hidden). */
  referenceImage: string;
}

export interface ChatMessage {
  from: Role;
  text: string;
}

/** A published task: the reference render plus server-assigned id/time. */
export interface TaskEntry {
  id: number;
  /** Data URL of the reference render (expert's view, helpers hidden). */
  referenceImage: string;
  /** Wall-clock publish time (epoch ms) for labelling. */
  createdAt: number;
}

/** A submitted attempt: the novice's rendered view (helpers hidden) plus its state for future diff/hints. */
export interface Attempt {
  id: number;
  /** The published task this attempt belongs to. */
  taskId: number;
  /** Data URL of the novice's render at submit time. */
  image: string;
  camera: CameraState;
  light: LightState;
  /** Wall-clock time of submission (epoch ms) for labelling. */
  createdAt: number;
}

/** What the novice sends on submit (id and timestamp are server-assigned; taskId picks the target task). */
export type AttemptPayload = Omit<Attempt, 'id' | 'createdAt'>;

/** A role's live scene state, streamed while working. */
export interface StateSnapshot {
  camera: CameraState;
  light: LightState;
}

export interface ClientToServerEvents {
  /** Pair an iPhone controller with an existing session. */
  'phone:pair': (
    code: string,
    targetRole: Role,
    ack: (result: { ok: boolean; error?: string }) => void
  ) => void;

  /** Normalized phone tilt, between -1 and 1. */
  'phone:orientation': (orientation: { x: number; y: number }) => void;
  /** Expert creates a session and becomes its expert. */
  'session:create': (ack: (meta: SessionMeta) => void) => void;
  /** Novice joins by 5-character session code. */
  'session:join': (code: string, ack: (result: JoinResult) => void) => void;
  /** Voluntarily leave the session; frees the role slot immediately. */
  'session:leave': () => void;
  /** Any role streams its live camera + light state. */
  'state:update': (snapshot: StateSnapshot) => void;
  /** Expert publishes (or replaces) the target state and starts the task. */
  'task:publish': (target: TaskTarget) => void;
  /** Novice requests a single opt-in hint for the selected task. */
  'hint:request': (request: { taskId: number; snapshot: StateSnapshot }) => void;
  /** Novice opts into progress cues for one attribute on the selected task. */
  'audio-feedback:select': (selection: {
    taskId: number;
    attribute: AudioFeedbackAttribute;
    snapshot: StateSnapshot;
  } | null) => void;
  /** Novice submits an attempt snapshot (renders its own view, helpers hidden). */
  'attempt:submit': (attempt: AttemptPayload) => void;
  /** Expert sends feedback attached to a submission. */
  'feedback:send': (feedback: { attemptId: number; text: string }) => void;
  /** Novice marks feedback for one submission as reviewed. */
  'feedback:read': (attemptId: number) => void;
  'chat:message': (text: string) => void;
}

export interface ServerToClientEvents {
   /** Phone movement forwarded to the selected desktop role. */
  'phone:orientation': (orientation: {
    targetRole: Role;
    x: number;
    y: number;
  }) => void;
  'session:meta': (meta: SessionMeta) => void;
  'task:start': (task: TaskStart) => void;
  /** A new task was published (adds to the task history on both clients). */
  'task:published': (task: TaskEntry) => void;
  'attempt:submitted': () => void;
  'attempt:saved': (attempt: Attempt) => void;
  /** Feedback associated with one attempt, sent to the novice. */
  'feedback:new': (feedback: AttemptFeedback) => void;
  /** Current feedback state replayed to a novice who joins late. */
  'feedback:current': (feedback: AttemptFeedback[]) => void;
  'feedback:saved': (feedback: AttemptFeedback) => void;
  'feedback:error': (message: string) => void;
  /** Detailed setup differences are delivered only to the expert. */
  'attempt:review': (review: AttemptReview) => void;
  'hint:result': (hint: TaskHint | null) => void;
  'hint:error': (message: string) => void;
  /** Qualitative progress cue for the novice's selected audio-feedback attribute. */
  'audio-feedback:progress': (progress: AudioFeedbackProgress) => void;
  'audio-feedback:error': (message: string) => void;
  'chat:error': (message: string) => void;
  /** Full history replay (late joiners). */
  'tasks:current': (tasks: TaskEntry[]) => void;
  'attempts:current': (attempts: Attempt[]) => void;
  'peer:update': (msg: { from: Role; snapshot: StateSnapshot }) => void;
  'chat:message': (msg: ChatMessage) => void;
}

export {
  compareTaskStates,
  DEFAULT_TOLERANCES,
  feedbackSuggestions,
  nextTaskHint,
} from './feedback.js';
