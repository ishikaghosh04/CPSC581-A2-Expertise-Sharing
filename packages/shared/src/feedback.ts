import type {
  CameraState,
  LightState,
  StateSnapshot,
  TaskDiff,
  TaskHint,
  TaskTarget,
  Vec3,
} from './index.js';

export const DEFAULT_TOLERANCES = {
  position: 0.3,
  angle: 8,
  intensity: 0.15,
} as const;

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function direction(light: LightState): Vec3 {
  return {
    x: light.target.x - light.position.x,
    y: light.target.y - light.position.y,
    z: light.target.z - light.position.z,
  };
}

function angleDegrees(a: Vec3, b: Vec3): number {
  const aLength = Math.hypot(a.x, a.y, a.z);
  const bLength = Math.hypot(b.x, b.y, b.z);
  if (aLength === 0 || bLength === 0) {
    return aLength === bLength ? 0 : 180;
  }
  const cosine =
    (a.x * b.x + a.y * b.y + a.z * b.z) / (aLength * bLength);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

export function compareTaskStates(target: TaskTarget, current: StateSnapshot): TaskDiff {
  const targetDirection = direction(target.light);
  const currentDirection = direction(current.light);

  return {
    cameraPositionDistance: distance(target.camera.position, current.camera.position),
    cameraTargetDistance: distance(target.camera.target, current.camera.target),
    lightPositionDistance: distance(target.light.position, current.light.position),
    lightAimAngleDegrees: angleDegrees(targetDirection, currentDirection),
    lightIntensityDifference: Math.abs(target.light.intensity - current.light.intensity),
  };
}

function dominantAxis(delta: Vec3, camera: CameraState): string {
  const forward = {
    x: camera.target.x - camera.position.x,
    y: camera.target.y - camera.position.y,
    z: camera.target.z - camera.position.z,
  };
  const forwardLength = Math.hypot(forward.x, forward.y, forward.z) || 1;
  forward.x /= forwardLength;
  forward.y /= forwardLength;
  forward.z /= forwardLength;
  const right = { x: -forward.z, y: 0, z: forward.x };
  const rightLength = Math.hypot(right.x, right.z) || 1;
  right.x /= rightLength;
  right.z /= rightLength;
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  const projections = [
    { name: 'right', value: delta.x * right.x + delta.y * right.y + delta.z * right.z },
    { name: 'up', value: delta.x * up.x + delta.y * up.y + delta.z * up.z },
    { name: 'farther', value: delta.x * forward.x + delta.y * forward.y + delta.z * forward.z },
  ];
  const dominant = projections.reduce((best, item) =>
    Math.abs(item.value) > Math.abs(best.value) ? item : best
  );
  if (Math.abs(dominant.value) < 1e-6) return 'slightly';
  if (dominant.name === 'right') return dominant.value > 0 ? 'right' : 'left';
  if (dominant.name === 'up') return dominant.value > 0 ? 'up' : 'down';
  return dominant.value > 0 ? 'farther' : 'closer';
}

function vectorDelta(target: Vec3, current: Vec3): Vec3 {
  return {
    x: target.x - current.x,
    y: target.y - current.y,
    z: target.z - current.z,
  };
}

export function nextTaskHint(
  target: TaskTarget,
  current: StateSnapshot,
  diff = compareTaskStates(target, current)
): TaskHint | null {
  if (diff.cameraPositionDistance > DEFAULT_TOLERANCES.position) {
    const direction = dominantAxis(
      vectorDelta(target.camera.position, current.camera.position),
      current.camera
    );
    return {
      component: 'camera-position',
      text: direction === 'slightly'
        ? 'Adjust your camera position to better match the reference.'
        : `Move your camera ${direction}.`,
    };
  }
  if (diff.cameraTargetDistance > DEFAULT_TOLERANCES.position) {
    const direction = dominantAxis(
      vectorDelta(target.camera.target, current.camera.target),
      current.camera
    );
    return {
      component: 'camera-aim',
      text: direction === 'slightly'
        ? 'Adjust where your camera is looking.'
        : `Aim your camera ${direction}.`,
    };
  }
  if (diff.lightPositionDistance > DEFAULT_TOLERANCES.position) {
    const direction = dominantAxis(
      vectorDelta(target.light.position, current.light.position),
      current.camera
    );
    return {
      component: 'light-position',
      text: direction === 'slightly'
        ? 'Move the light closer to the target position.'
        : `Move the light ${direction}.`,
    };
  }
  if (diff.lightAimAngleDegrees > DEFAULT_TOLERANCES.angle) {
    const direction = dominantAxis(
      vectorDelta(target.light.target, current.light.target),
      current.camera
    );
    return {
      component: 'light-aim',
      text: direction === 'slightly'
        ? 'Adjust the light aim to better match the reference.'
        : `Aim the light ${direction}.`,
    };
  }
  if (diff.lightIntensityDifference > DEFAULT_TOLERANCES.intensity) {
    return {
      component: 'intensity',
      text: target.light.intensity > current.light.intensity
        ? 'Make the light brighter.'
        : 'Make the light dimmer.',
    };
  }
  return null;
}

export function feedbackSuggestions(target: TaskTarget, current: StateSnapshot): string[] {
  const hint = nextTaskHint(target, current);
  if (!hint) {
    return [
      'Great match — your camera and lighting are very close.',
      'Nice work. The setup closely matches the target.',
      'You have matched the target setup.',
    ];
  }

  return [
    `Try this next: ${hint.text}`,
    `You're making progress. ${hint.text}`,
    `One small adjustment: ${hint.text}`,
  ];
}
