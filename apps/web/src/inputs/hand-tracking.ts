import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

export type HandPreference = 'left' | 'either';
export type CameraRunState = 'off' | 'starting' | 'running' | 'error';

export interface FingertipPosition {
  x: number;
  y: number;
}

export interface GestureFeedback {
  hand: 'Left' | 'Right' | null;
  fingers: number;
  fingertips: FingertipPosition[];
  holdProgress: number;
  applied: boolean;
  state: 'none' | 'unsupported' | 'supported';
}

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const STABILITY_MS = 700;
const FRAME_INTERVAL_MS = 70;

function isFingerExtended(
  landmarks: NormalizedLandmark[],
  tipIndex: number,
  jointIndex: number
): boolean {
  const tip = landmarks[tipIndex];
  const joint = landmarks[jointIndex];
  return tip !== undefined && joint !== undefined && tip.y < joint.y;
}

function raisedFingerTipIndices(
  landmarks: NormalizedLandmark[],
  hand: 'Left' | 'Right'
): number[] {
  const thumbTip = landmarks[4];
  const thumbJoint = landmarks[3];
  const thumbIsExtended = thumbTip !== undefined && thumbJoint !== undefined
    && (hand === 'Left'
      ? thumbTip.x > thumbJoint.x
      : thumbTip.x < thumbJoint.x);
  const fingers: Array<{ tip: number; extended: boolean }> = [
    { tip: 4, extended: thumbIsExtended },
    { tip: 8, extended: isFingerExtended(landmarks, 8, 6) },
    { tip: 12, extended: isFingerExtended(landmarks, 12, 10) },
    { tip: 16, extended: isFingerExtended(landmarks, 16, 14) },
    { tip: 20, extended: isFingerExtended(landmarks, 20, 18) },
  ];
  return fingers.filter((finger) => finger.extended).map((finger) => finger.tip);
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

export class HandGestureController {
  private stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private frameRequest = 0;
  private runId = 0;
  private preference: HandPreference = 'left';
  private candidate: string | null = null;
  private candidateSince = 0;
  private appliedCandidate: string | null = null;
  private lastFrameAt = 0;
  private enabled = true;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onStatus: (message: string, state?: CameraRunState) => void,
    private readonly onGestureFeedback: (feedback: GestureFeedback) => void,
    private readonly onStableGesture: (fingers: number) => void
  ) {}

  setPreference(preference: HandPreference): void {
    this.preference = preference;
    this.resetCandidate();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.resetCandidate();
  }

  async start(): Promise<void> {
    const runId = ++this.runId;
    this.onStatus('Requesting camera permission…', 'starting');
    let loadingTracker = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        this.onStatus(
          'Camera access is unavailable. Use a supported browser on HTTPS or localhost.',
          'error'
        );
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (runId !== this.runId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.onStatus('Camera on · Loading hand tracking…', 'running');

      loadingTracker = true;
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const wasmFileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const landmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      if (runId !== this.runId) {
        landmarker.close();
        return;
      }

      this.landmarker = landmarker;
      this.onStatus('Camera on.', 'running');
      this.detectFrame(runId);
    } catch (error) {
      if (runId !== this.runId) return;
      console.error('hand tracking could not start', error);
      const message = loadingTracker
        ? 'Could not load hand tracking. Check your internet connection and try again.'
        : cameraErrorMessage(error);
      this.stopWithStatus(message, 'error');
    }
  }

  stop(): void {
    ++this.runId;
    this.stopWithStatus('Camera is off.');
  }

  private detectFrame(runId: number): void {
    if (runId !== this.runId || !this.landmarker) return;
    this.frameRequest = requestAnimationFrame((time) => {
      if (runId !== this.runId || !this.landmarker) return;
      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && time - this.lastFrameAt >= FRAME_INTERVAL_MS) {
        this.lastFrameAt = time;
        try {
          const result = this.landmarker.detectForVideo(this.video, time);
          this.processResult(result);
        } catch (error) {
          console.error('hand gesture detection failed', error);
          this.stopWithStatus('Hand tracking stopped because frame processing failed.');
          return;
        }
      }
      this.detectFrame(runId);
    });
  }

  private processResult(result: ReturnType<HandLandmarker['detectForVideo']>): void {
    if (!this.enabled) {
      this.resetCandidate();
      return;
    }

    const matches: Array<{
      hand: 'Left' | 'Right';
      fingertips: FingertipPosition[];
    }> = [];
    result.landmarks.forEach((landmarks, index) => {
      const category = result.handedness[index]?.[0];
      if (!category
        || (category.categoryName !== 'Left' && category.categoryName !== 'Right')) return;

      // MediaPipe handedness assumes a mirrored selfie input; this video is not mirrored for inference.
      const hand = category.categoryName === 'Left' ? 'Right' : 'Left';
      if (this.preference === 'left' && hand !== 'Left') return;
      const fingertipIndices = raisedFingerTipIndices(landmarks, hand);
      matches.push({
        hand,
        fingertips: fingertipIndices.flatMap((landmarkIndex) => {
          const point = landmarks[landmarkIndex];
          return point ? [{ x: point.x, y: point.y }] : [];
        }),
      });
    });

    const match = matches.find((item) => item.fingertips.length >= 1 && item.fingertips.length <= 3);
    if (!match) {
      this.resetCandidate();
      const unsupported = matches[0];
      this.onGestureFeedback(unsupported
        ? {
            hand: unsupported.hand,
            fingers: unsupported.fingertips.length,
            fingertips: unsupported.fingertips,
            holdProgress: 0,
            applied: false,
            state: 'unsupported',
          }
        : {
            hand: null,
            fingers: 0,
            fingertips: [],
            holdProgress: 0,
            applied: false,
            state: 'none',
          });
      return;
    }

    const fingers = match.fingertips.length;
    const key = `${match.hand}:${fingers}`;
    const now = performance.now();
    if (key !== this.candidate) {
      this.candidate = key;
      this.candidateSince = now;
      this.appliedCandidate = null;
      this.onGestureFeedback({
        hand: match.hand,
        fingers,
        fingertips: match.fingertips,
        holdProgress: 0,
        applied: false,
        state: 'supported',
      });
      return;
    }

    const holdProgress = Math.min(now - this.candidateSince, STABILITY_MS);
    const isSelected = this.appliedCandidate === key;
    this.onGestureFeedback({
      hand: match.hand,
      fingers,
      fingertips: match.fingertips,
      holdProgress,
      applied: isSelected,
      state: 'supported',
    });
    if (now - this.candidateSince >= STABILITY_MS && this.appliedCandidate !== key) {
      this.onStableGesture(fingers);
      this.appliedCandidate = key;
      this.onGestureFeedback({
        hand: match.hand,
        fingers,
        fingertips: match.fingertips,
        holdProgress: STABILITY_MS,
        applied: true,
        state: 'supported',
      });
    }
  }

  private resetCandidate(): void {
    this.candidate = null;
    this.candidateSince = 0;
    this.appliedCandidate = null;
  }

  private stopWithStatus(message: string, state: CameraRunState = 'off'): void {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.landmarker?.close();
    this.landmarker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.resetCandidate();
    this.onGestureFeedback({
      hand: null,
      fingers: 0,
      fingertips: [],
      holdProgress: 0,
      applied: false,
      state: 'none',
    });
    this.onStatus(message, state);
  }
}
