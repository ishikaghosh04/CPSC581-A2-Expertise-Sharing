import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import {
  INTENSITY_PRESETS,
  type CameraState,
  type IntensityPreset,
  type LightState,
} from '@expertise-sharing/shared';

/**
 * The shared 3D workspace (build step 2). Every role gets its own camera and
 * its own light in an identical static room; the objects never change.
 */

export const DEFAULT_CAMERA: CameraState = {
  position: { x: 4.5, y: 3.2, z: 6 },
  target: { x: 0, y: 0.8, z: 0 },
};

export const DEFAULT_LIGHT: LightState = {
  position: { x: 2.5, y: 3.0, z: 2.0 },
  target: { x: -0.5, y: 0.6, z: 0 },
  intensity: INTENSITY_PRESETS.medium,
};

/** Which gizmo is currently attached in Move light / Aim light. */
export type LightHandle = 'bulb' | 'aim';

export interface SceneHandle {
  /** Serialized current camera and light state. */
  state(): { camera: CameraState; light: LightState };
  /** Render the current view minus helpers as a PNG data URL (reference image). */
  captureReference(): Promise<string>;
  setIntensityPreset(preset: IntensityPreset): void;
  setHandle(handle: LightHandle): void;
  setHeadOffset(x: number, y: number): void;
  resetCamera(): void;
  resetLight(): void;
  dispose(): void;
}

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

function buildRoom(scene: THREE.Scene): void {
  // Light grey floor: shows off pools of light and shadows.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Back wall — gives the light something to graze and shadow against.
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 3),
    new THREE.MeshStandardMaterial({ color: 0x84848e, roughness: 0.95 })
  );
  wall.position.set(0, 1.5, -5);
  wall.receiveShadow = true;
  scene.add(wall);

  // A few coloured cubes (placeholder scene per plan).
  const cubes: Array<[color: number, pos: [number, number, number], size: number]> = [
    [0xf2a7b3, [-1.3, 0.5, -0.6], 1.0],
    [0xb2e8d0, [0.6, 0.9, -1.6], 1.8],
    [0xb3bdf2, [1.6, 0.6, 0.9], 1.2],
  ];
  for (const [color, [x, y, z], size] of cubes) {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    );
    cube.position.set(x, y, z);
    cube.castShadow = true;
    cube.receiveShadow = true;
    scene.add(cube);
  }
}

export function createScene(
  container: HTMLElement,
  onState?: (camera: CameraState, light: LightState) => void,
  previewCanvas?: HTMLCanvasElement
): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  container.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0e12);

  // Bright fill so nothing is pitch black before the spot is placed.
  scene.add(new THREE.HemisphereLight(0x505070, 0x1c1c24, 0.45));

  buildRoom(scene);

  const spot = new THREE.SpotLight(0xffffff, DEFAULT_LIGHT.intensity);
  spot.position.set(DEFAULT_LIGHT.position.x, DEFAULT_LIGHT.position.y, DEFAULT_LIGHT.position.z);
  spot.angle = 0.65;
  spot.penumbra = 0.45;
  spot.decay = 1.0;
  spot.distance = 30;
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0005;
  scene.add(spot);

  // Handles: the gizmo drags the spotlight itself (Move light) and the aim
  // marker, which IS the spotlight's target object (Aim light) — moving the
  // marker re-aims the beam directly. The bulb is a visual follower.
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0 })
  );
  bulb.position.copy(spot.position);
  scene.add(bulb);

  const aimMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x5a9dfd })
  );
  aimMarker.position.set(
    DEFAULT_LIGHT.target.x,
    DEFAULT_LIGHT.target.y,
    DEFAULT_LIGHT.target.z
  );
  scene.add(aimMarker);
  spot.target = aimMarker;

  const beam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([bulb.position, aimMarker.position]),
    new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.6 })
  );
  scene.add(beam);

  // --- Camera ----------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    100
  );
  camera.position.set(DEFAULT_CAMERA.position.x, DEFAULT_CAMERA.position.y, DEFAULT_CAMERA.position.z);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.target.set(DEFAULT_CAMERA.target.x, DEFAULT_CAMERA.target.y, DEFAULT_CAMERA.target.z);
  // Head tracking controls
  let headOffset = { x: 0, y: 0 };

  const setHeadOffset = (x: number, y: number): void => {
    headOffset.x = THREE.MathUtils.clamp(x, -1, 1);
    headOffset.y = THREE.MathUtils.clamp(y, -1, 1);
  };

  // --- Gizmo -----------------------------------------------------------
  const transform = new TransformControls(camera, renderer.domElement);
  transform.setSize(0.85);
  scene.add(transform.getHelper());
  transform.attach(spot);

  transform.addEventListener('dragging-changed', (event) => {
    type DragEvent = { value: boolean };
    orbit.enabled = !(event as DragEvent).value;
  });

  // --- State -----------------------------------------------------------
  const toVec3 = (v: THREE.Vector3): { x: number; y: number; z: number } => ({
    x: Number(v.x.toFixed(3)),
    y: Number(v.y.toFixed(3)),
    z: Number(v.z.toFixed(3)),
  });

  const state = (): { camera: CameraState; light: LightState } => ({
    camera: {
      position: toVec3(camera.position),
      target: toVec3(orbit.target),
    },
    light: {
      position: toVec3(spot.position),
      target: toVec3(spot.target.position),
      intensity: Number(spot.intensity.toFixed(2)),
    },
  });

  const applyLight = (light: LightState): void => {
    spot.position.set(
      clamp(light.position.x, -9, 9),
      clamp(light.position.y, 0.2, 9),
      clamp(light.position.z, -9, 9)
    );
    spot.target.position.set(
      clamp(light.target.x, -5, 5),
      clamp(light.target.y, 0, 4),
      clamp(light.target.z, -5, 5)
    );
    spot.intensity = light.intensity;
    beam.geometry.setFromPoints([bulb.position, aimMarker.position]);
  };

  const setIntensityPreset = (preset: IntensityPreset): void => {
    spot.intensity = INTENSITY_PRESETS[preset];
  };

  const setHandle = (handle: LightHandle): void => {
    // Drag the spotlight object itself (bulb visual follows), or the marker.
    transform.attach(handle === 'bulb' ? spot : aimMarker);
  };

  const resetCamera = (): void => {
    camera.position.set(DEFAULT_CAMERA.position.x, DEFAULT_CAMERA.position.y, DEFAULT_CAMERA.position.z);
    orbit.target.set(DEFAULT_CAMERA.target.x, DEFAULT_CAMERA.target.y, DEFAULT_CAMERA.target.z);
    orbit.update();
  };

  const resetLight = (): void => {
    applyLight(DEFAULT_LIGHT);
  };

  // --- Lifecycle -------------------------------------------------------
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = Math.max(container.clientHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  resizeObserver.observe(container);

  let frame = 0;
  const animate = (): void => {
    frame = requestAnimationFrame(animate);

    orbit.update();
  
    // Apply temporary head movement relative to the normal camera.
    // Restore the camera afterward so OrbitControls remains independent.
    const basePosition = camera.position.clone();
    const baseQuaternion = camera.quaternion.clone();

    const right = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(baseQuaternion);
    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(baseQuaternion);

    camera.position.addScaledVector(right, headOffset.x * 0.7);
    camera.position.addScaledVector(up, -headOffset.y * 0.5);
    camera.lookAt(orbit.target);

    bulb.position.copy(spot.position);
    beam.geometry.setFromPoints([bulb.position, aimMarker.position]);

    renderer.render(scene, camera);

    camera.position.copy(basePosition);
    camera.quaternion.copy(baseQuaternion);
  };
  animate();

  // Stream state a few times a second; the server relays it to the peer role.
  const stateInterval = onState ? window.setInterval(() => onState(state().camera, state().light), 100) : null;

  // --- Reference preview -------------------------------------------------
  // Second small renderer: same camera pose, helpers hidden — shows exactly
  // what the novice's reference image will look like, live during setup.
  let previewRenderer: THREE.WebGLRenderer | null = null;
  if (previewCanvas) {
    previewRenderer = new THREE.WebGLRenderer({ antialias: true, canvas: previewCanvas });
    previewRenderer.shadowMap.enabled = true;
    previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    previewRenderer.setPixelRatio(1);
  }

  const previewHelpers: THREE.Object3D[] = [bulb, aimMarker, beam, transform.getHelper()];

  const renderPreview = (): void => {
    if (!previewRenderer || !previewCanvas) return;
    const w = Math.max(previewCanvas.clientWidth, 2);
    const h = Math.max(previewCanvas.clientHeight, 2);
    const mainAspect = camera.aspect;
    for (const helper of previewHelpers) helper.visible = false;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    previewRenderer.setSize(w, h, false);
    previewRenderer.render(scene, camera);
    camera.aspect = mainAspect;
    camera.updateProjectionMatrix();
    for (const helper of previewHelpers) helper.visible = true;
  };

  const previewInterval = previewRenderer
    ? window.setInterval(renderPreview, 500)
    : null;
  if (previewRenderer) renderPreview();

  // One-off reference capture: fresh 16:9 canvas, helpers hidden, exactly the
  // framing the novice replicates (same AR as their viewport).
  const captureReference = async (): Promise<string> => {
    const W = 960;
    const H = 540;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const captureRenderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas,
      preserveDrawingBuffer: true,
    });
    captureRenderer.shadowMap.enabled = true;
    captureRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    captureRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    captureRenderer.setPixelRatio(1);
    captureRenderer.setSize(W, H, false);

    const mainAspect = camera.aspect;
    for (const helper of previewHelpers) helper.visible = false;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    captureRenderer.render(scene, camera);
    camera.aspect = mainAspect;
    camera.updateProjectionMatrix();
    for (const helper of previewHelpers) helper.visible = true;

    const url = canvas.toDataURL('image/png');
    captureRenderer.dispose();
    return url;
  };

  return {
    state,
    captureReference,
    setHeadOffset,
    setIntensityPreset,
    setHandle,
    resetCamera,
    resetLight,
    dispose(): void {
      if (stateInterval !== null) window.clearInterval(stateInterval);
      if (previewInterval !== null) window.clearInterval(previewInterval);
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      previewRenderer?.dispose();
    },
  };
}
