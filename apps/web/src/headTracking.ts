
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface HeadPosition {
  x: number;
  y: number;
}

export interface HeadTracker {
  start(): Promise<void>;
  stop(): void;
}

export function createHeadTracker(
  onMove: (position: HeadPosition) => void
): HeadTracker {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let landmarker: FaceLandmarker | null = null;
  let animationId = 0;
  let running = false;
  let neutral: HeadPosition | null = null;
  let smoothed: HeadPosition = { x: 0, y: 0 };

  async function start(): Promise<void> {
    if (running) return;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });

      video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
      );

      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
      });

      running = true;
      neutral = null;
      smoothed = { x: 0, y: 0 };

      function detect(): void {
        if (!running || !video || !landmarker) return;

        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const result = landmarker.detectForVideo(video, performance.now());
          const face = result.faceLandmarks[0];

          if (face) {
            // Landmark 1 is approximately the nose tip.
            const nose = face[1];

            if (!nose) {
            animationId = requestAnimationFrame(detect);
            return;
            }

            const current = { x: nose.x, y: nose.y };

            if (!neutral) neutral = current;

            const dx = (current.x - neutral.x) * 5;
            const dy = (current.y - neutral.y) * 5;

            // Smooth the movement to reduce camera jitter.
            smoothed.x += (dx - smoothed.x) * 0.12;
            smoothed.y += (dy - smoothed.y) * 0.12;

            onMove({
              x: Math.max(-1, Math.min(1, smoothed.x)),
              y: Math.max(-1, Math.min(1, smoothed.y)),
            });
          }
        }

        animationId = requestAnimationFrame(detect);
      }

      detect();
    } catch (error) {
      stop();
      throw error;
    }
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(animationId);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;

    if (video) {
      video.pause();
      video.srcObject = null;
      video = null;
    }

    landmarker?.close();
    landmarker = null;
    neutral = null;
    onMove({ x: 0, y: 0 });
  }

  return { start, stop };
}
