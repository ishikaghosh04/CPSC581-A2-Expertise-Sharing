import * as THREE from 'three';

import {
  INTENSITY_PRESETS,
  type CameraState,
  type LightState,
  type SceneId,
} from '@expertise-sharing/shared';

/**
 * Static scene definitions (build step 2, extended). Each scene renders the
 * same room shell with a different set of objects; objects are shared context
 * within a task and never change. Only basic geometries and mid-tone
 * MeshStandardMaterials are used so light direction, intensity, and shadows
 * stay legible — and so nothing animates and reference captures stay valid.
 */

export interface SceneDefinition {
  id: SceneId;
  /** Default camera framing for this scene (used by Reset camera). */
  camera: CameraState;
  /** Default light setup for this scene (used by Reset light). */
  light: LightState;
  /** Build the scene's static objects into a group. */
  build(): THREE.Group;
}

const material = (color: number, roughness: number): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness });

function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  roughness = 0.6
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material(color, roughness)
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Shared floor + optional back wall; most scenes sit in this shell. */
function buildShell(
  group: THREE.Group,
  wallHeight = 3,
  includeWall = true,
  floorColor = 0x9a9aa2,
  wallColor = 0x84848e
): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    material(floorColor, 0.9)
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  if (includeWall) {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(10, wallHeight),
      material(wallColor, 0.95)
    );
    wall.position.set(0, wallHeight / 2, -5);
    wall.receiveShadow = true;
    group.add(wall);
  }
}

// --- Classic placeholder (tutorial) -----------------------------------------

function buildClassic(): THREE.Group {
  const group = new THREE.Group();
  buildShell(group);

  // A few coloured cubes (placeholder scene per plan).
  const cubes: Array<[color: number, pos: [number, number, number], size: number]> = [
    [0xf2a7b3, [-1.3, 0.5, -0.6], 1.0],
    [0xb2e8d0, [0.6, 0.9, -1.6], 1.8],
    [0xb3bdf2, [1.6, 0.6, 0.9], 1.2],
  ];
  for (const [color, [x, y, z], size] of cubes) {
    const cube = box(size, size, size, color);
    cube.position.set(x, y, z);
    group.add(cube);
  }
  return group;
}

// --- Desk vignette -----------------------------------------------------------
// L-shaped arrangement: desk with a target mug, a chair, and a tall cabinet
// whose shadow blocks obvious light placements from working.

function buildDeskVignette(): THREE.Group {
  const group = new THREE.Group();
  // Lighter floor and wall: surfaces brighten the scene while shadows and
  // light pools still land at full contrast (TEST variant).
  buildShell(group, 3.5, true, 0xc4c4cd, 0xb4b4c0);

  // Desk: top + four legs, near the wall on the left half.
  const desk = new THREE.Group();
  const top = box(2.4, 0.08, 1.1, 0xc9a173, 0.7);
  top.position.y = 0.91;
  desk.add(top);
  for (const [lx, lz] of [[-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45]] as const) {
    const leg = box(0.08, 0.87, 0.08, 0x8a6f4d, 0.8);
    leg.position.set(lx, 0.435, lz);
    desk.add(leg);
  }
  desk.position.set(-0.7, 0, -1.8);
  group.add(desk);

  // Mug: the small target the light must reach on the desk surface.
  const mug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.22, 20),
    material(0xd96c6c, 0.5)
  );
  mug.castShadow = true;
  mug.receiveShadow = true;
  mug.position.set(-1.4, 1.06, -1.9);
  group.add(mug);

  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.02, 10, 20, Math.PI),
    material(0xd96c6c, 0.5)
  );
  handle.rotation.z = Math.PI;
  handle.position.set(-1.24, 1.06, -1.9);
  group.add(handle);

  // Books on the desk: extra shadow variety at similar height to the mug.
  const bookA = box(0.34, 0.06, 0.26, 0x6f86b5, 0.8);
  bookA.position.set(-0.2, 0.98, -1.7);
  bookA.rotation.y = 0.2;
  group.add(bookA);
  const bookB = box(0.3, 0.05, 0.24, 0x87a985, 0.8);
  bookB.position.set(-0.18, 1.035, -1.68);
  bookB.rotation.y = -0.15;
  group.add(bookB);

  // Tall cabinet on the right: casts the big blocking shadow.
  const cabinet = box(1.0, 2.3, 0.7, 0x9d8f7f, 0.85);
  cabinet.position.set(2.4, 1.15, -4.4);
  group.add(cabinet);

  // Chair: seat, backrest, legs — left of the desk, partially in the way.
  const chair = new THREE.Group();
  const seat = box(0.62, 0.07, 0.6, 0xb5b0a6, 0.85);
  seat.position.y = 0.52;
  chair.add(seat);
  const backrest = box(0.62, 0.72, 0.07, 0xb5b0a6, 0.85);
  backrest.position.set(0, 0.91, -0.27);
  chair.add(backrest);
  for (const [lx, lz] of [[-0.27, -0.25], [0.27, -0.25], [-0.27, 0.25], [0.27, 0.25]] as const) {
    const leg = box(0.06, 0.5, 0.06, 0x8a857c, 0.85);
    leg.position.set(lx, 0.25, lz);
    chair.add(leg);
  }
  chair.position.set(-2.4, 0, -0.2);
  chair.rotation.y = 0.6;
  group.add(chair);

  return group;
}

// --- Shelf wall --------------------------------------------------------------
// Floating shelf with objects of graded heights; the wall behind is the main
// intensity/aim readout because the pool of light lands on it.

function buildShelfWall(): THREE.Group {
  const group = new THREE.Group();
  buildShell(group, 4);

  // Floating shelf on the back wall.
  const shelf = box(3.6, 0.07, 0.7, 0xc9a173, 0.7);
  shelf.position.set(0, 1.35, -4.4);
  group.add(shelf);
  for (const bx of [-1.6, 1.6]) {
    const bracket = box(0.07, 0.18, 0.55, 0x7c7c86, 0.9);
    bracket.position.set(bx, 1.22, -4.45);
    group.add(bracket);
  }

  // Graded-height objects on the shelf: the tall bottle is the usual target.
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.62, 20),
    material(0x6fa089, 0.35)
  );
  bottle.castShadow = true;
  bottle.receiveShadow = true;
  bottle.position.set(-0.9, 1.7, -4.4);
  group.add(bottle);

  const boxSmall = box(0.34, 0.34, 0.34, 0xd9b26f, 0.6);
  boxSmall.position.set(0.1, 1.56, -4.4);
  group.add(boxSmall);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 24, 24),
    material(0xc26f8a, 0.45)
  );
  ball.castShadow = true;
  ball.receiveShadow = true;
  ball.position.set(0.9, 1.5, -4.4);
  group.add(ball);

  // A low record crate on the floor keeps the lower half from being empty.
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.5, 0.5),
    material(0x8a7f73, 0.9)
  );
  crate.position.set(-1.6, 0.25, -4.5);
  crate.castShadow = true;
  crate.receiveShadow = true;
  group.add(crate);

  return group;
}

// --- Arch reveal -------------------------------------------------------------
// A wall with an arched doorway cut out of it; the target sits behind the
// wall so the light must pass through the opening — teaching the beam axis.

function buildArchReveal(): THREE.Group {
  const group = new THREE.Group();
  buildShell(group, 3, false); // floor only — the arch wall replaces the flat one

  // Wall with an arch opening, extruded as a solid slab.
  const wallShape = new THREE.Shape();
  wallShape.moveTo(-5, 0);
  wallShape.lineTo(5, 0);
  wallShape.lineTo(5, 4);
  wallShape.lineTo(-5, 4);
  wallShape.lineTo(-5, 0);

  const opening = new THREE.Path();
  opening.moveTo(-0.8, 0);
  opening.lineTo(-0.8, 1.7);
  opening.absarc(0, 1.7, 0.8, Math.PI, 0, true);
  opening.lineTo(0.8, 0);
  opening.lineTo(-0.8, 0);
  wallShape.holes.push(opening);

  const wall = new THREE.Mesh(
    new THREE.ExtrudeGeometry(wallShape, { depth: 0.35, bevelEnabled: false }),
    material(0x84848e, 0.95)
  );
  wall.position.set(0, 0, -3.2);
  wall.receiveShadow = true;
  wall.castShadow = true;
  group.add(wall);

  // Statue behind the wall: pedestal + torus-knot sculpture.
  const pedestal = box(0.55, 0.9, 0.55, 0xb0ada4, 0.85);
  pedestal.position.set(0, 0.45, -4.1);
  group.add(pedestal);

  const sculpture = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.22, 0.07, 120, 16),
    material(0xd4af37, 0.3)
  );
  sculpture.castShadow = true;
  sculpture.receiveShadow = true;
  sculpture.position.set(0, 1.28, -4.1);
  group.add(sculpture);

  return group;
}

/**
 * Scenes in selector order. Starts (camera/light) are deliberately modest:
 * the expert frames and lights from there, and Reset returns here.
 */
export const SCENE_DEFINITIONS: SceneDefinition[] = [
  {
    id: 'classic',
    camera: { position: { x: 4.5, y: 3.2, z: 6 }, target: { x: 0, y: 0.8, z: 0 } },
    light: {
      position: { x: 2.5, y: 3.0, z: 2.0 },
      target: { x: -0.5, y: 0.6, z: 0 },
      intensity: INTENSITY_PRESETS.medium,
    },
    build: buildClassic,
  },
  {
    id: 'desk-vignette',
    camera: { position: { x: 1.2, y: 2.6, z: 4.6 }, target: { x: -1.0, y: 0.9, z: -1.8 } },
    light: {
      position: { x: 1.6, y: 2.6, z: 0.4 },
      target: { x: -1.2, y: 0.9, z: -1.8 },
      intensity: INTENSITY_PRESETS.medium,
    },
    build: buildDeskVignette,
  },
  {
    id: 'shelf-wall',
    camera: { position: { x: 0.4, y: 2.4, z: 5.4 }, target: { x: 0.1, y: 1.4, z: -4.4 } },
    light: {
      position: { x: 0.4, y: 2.8, z: 0.6 },
      target: { x: 0.1, y: 1.5, z: -4.4 },
      intensity: INTENSITY_PRESETS.medium,
    },
    build: buildShelfWall,
  },
  {
    id: 'arch-reveal',
    camera: { position: { x: 2.2, y: 2.4, z: 4.8 }, target: { x: 0, y: 1.1, z: -4.1 } },
    light: {
      position: { x: 1.4, y: 3.0, z: 1.4 },
      target: { x: 0, y: 1.2, z: -2.6 },
      intensity: INTENSITY_PRESETS.medium,
    },
    build: buildArchReveal,
  },
];

export function sceneDefinition(id: SceneId): SceneDefinition {
  const def = SCENE_DEFINITIONS.find((item) => item.id === id);
  if (!def) throw new Error(`Unknown scene id: ${id}`);
  return def;
}
