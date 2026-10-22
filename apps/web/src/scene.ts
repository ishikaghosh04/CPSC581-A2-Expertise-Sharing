import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import {
  INTENSITY_PRESETS,
  type CameraState,
  type IntensityPreset,
  type LightState,
  type SceneId,
} from '@expertise-sharing/shared';

import { sceneDefinition } from './scenes.js';

/**
 * The shared 3D workspace (build step 2, extended with a per-task scene
 * selector). Every role gets its own camera and its own light in an identical
 * static scene; the objects never change. Scenes come from `scenes.ts`.
 */

const INITIAL_SCENE: SceneId = 'classic';

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
  setPhoneAim(x: number, y: number, z: number): void;
  /** Swap the static scene, resetting camera and light to its defaults. */
  setScene(id: SceneId): void;
  resetCamera(): void;
  resetLight(): void;
  dispose(): void;
}

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

/** Dispose the geometries and materials of a scene group before removal. */
function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const mat = object.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
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
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0e12);

  // Bright fill so nothing is pitch black before the spot is placed.
  scene.add(new THREE.HemisphereLight(0x505070, 0x1c1c24, 0.45));

  // Static scene objects live in their own group so they can be swapped per task.
  let currentSceneId: SceneId = INITIAL_SCENE;
  let staticGroup = sceneDefinition(currentSceneId).build();
  scene.add(staticGroup);
  const defaults = (): { camera: CameraState; light: LightState } =>
    sceneDefinition(currentSceneId);

  const initialLight = defaults().light;
  const spot = new THREE.SpotLight(0xffffff, initialLight.intensity);
  spot.position.set(
    initialLight.position.x,
    initialLight.position.y,
    initialLight.position.z
  );
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
    initialLight.target.x,
    initialLight.target.y,
    initialLight.target.z
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
  const initialCamera = defaults().camera;
  camera.position.set(
    initialCamera.position.x,
    initialCamera.position.y,
    initialCamera.position.z
  );

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.target.set(
    initialCamera.target.x,
    initialCamera.target.y,
    initialCamera.target.z
  );
  // Head tracking controls
  let headOffset = { x: 0, y: 0 };

  const setHeadOffset = (x: number, y: number): void => {
    headOffset.x = THREE.MathUtils.clamp(x, -1, 1);
    headOffset.y = THREE.MathUtils.clamp(y, -1, 1);
  };
  
  
  const setPhoneAim = (x: number, y: number, z: number): void => {
    const direction = new THREE.Vector3(x, y, z);

    if (direction.lengthSq() < 0.001) return;
    direction.normalize();

    // Original spotlight direction.
    const initialAim = defaults().light;
    const defaultDirection = new THREE.Vector3(
      initialAim.target.x - initialAim.position.x,
      initialAim.target.y - initialAim.position.y,
      initialAim.target.z - initialAim.position.z
    );

    const distance = defaultDirection.length();
    defaultDirection.normalize();

    // Align the phone's initial forward direction
    // with the spotlight's default direction.
    const alignment = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      defaultDirection
    );

    direction.applyQuaternion(alignment);

    const newTarget = spot.position.clone()
      .addScaledVector(direction, distance);

    aimMarker.position.set(
      clamp(newTarget.x, -5, 5),
      clamp(newTarget.y, 0, 4),
      clamp(newTarget.z, -5, 5)
    );
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
    camera.position.set(
      defaults().camera.position.x,
      defaults().camera.position.y,
      defaults().camera.position.z
    );
    orbit.target.set(
      defaults().camera.target.x,
      defaults().camera.target.y,
      defaults().camera.target.z
    );
    orbit.update();
  };

  const resetLight = (): void => {
    applyLight(defaults().light);
  };

  const setScene = (id: SceneId): void => {
    if (id === currentSceneId) return;
    scene.remove(staticGroup);
    disposeGroup(staticGroup);
    currentSceneId = id;
    staticGroup = sceneDefinition(id).build();
    scene.add(staticGroup);
    resetCamera();
    resetLight();
  };

  // --- Lifecycle -------------------------------------------------------
  const resizeScene = (): void => {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  const resizeObserver = new ResizeObserver(resizeScene);
  resizeObserver.observe(container);
  window.addEventListener('resize', resizeScene);
  resizeScene();

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

    camera.position.addScaledVector(right, headOffset.x * 3.0);
    camera.position.addScaledVector(up, -headOffset.y * 2.5);
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

  const previewResizeObserver = previewRenderer && previewCanvas
    ? new ResizeObserver(renderPreview)
    : null;
  if (previewResizeObserver && previewCanvas) previewResizeObserver.observe(previewCanvas);

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
    setPhoneAim,
    setIntensityPreset,
    setHandle,
    setScene,
    resetCamera,
    resetLight,
    dispose(): void {
      if (stateInterval !== null) window.clearInterval(stateInterval);
      if (previewInterval !== null) window.clearInterval(previewInterval);
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', resizeScene);
      previewResizeObserver?.disconnect();
      transform.dispose();
      orbit.dispose();
      disposeGroup(staticGroup);
      renderer.dispose();
      previewRenderer?.dispose();
    },
  };
}
