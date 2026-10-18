// E2E smoke test for the protocol. Start the server first:
//   PORT=3901 npm start --workspace apps/server
// then run: node scripts/smoke.mjs  (target: SMOKE_URL or localhost:3901)
import { io } from 'socket.io-client';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3901';
const log = (...m) => console.log(...m);

const once = (socket, event) =>
  new Promise((resolve) => socket.once(event, resolve));

const IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const main = async () => {
  const expert = io(URL);
  await once(expert, 'connect');

  // 1. Expert creates a session.
  const meta = await new Promise((resolve) => expert.emit('session:create', resolve));
  log('expert created session', meta.code);

  const novice = io(URL);
  await once(novice, 'connect');

  // 2. Novice joins by code.
  const join = await new Promise((resolve) => novice.emit('session:join', meta.code, resolve));
  if (!join.ok) throw new Error(`novice join failed: ${join.error}`);
  log('novice joined', join.role);

  // 3. Expert publishes task 1; novice receives task:start with a reference image.
  const publish1 = Promise.all([
    once(novice, 'task:start'),
    once(novice, 'task:published'),
  ]);
  expert.emit('task:publish', {
    camera: { position: { x: 0, y: 1.6, z: 3 }, target: { x: 0, y: 1, z: 0 } },
    light: { position: { x: 1, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 1.5 },
    referenceImage: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  });
  const [start1] = await publish1;
  log('novice received task:start, reference image bytes =', start1.referenceImage.length);

  // 4. Novice submits attempt 1 and 2 for task 1.
  const saved1 = once(expert, 'attempt:saved');
  novice.emit('attempt:submit', {
    camera: { position: { x: 0, y: 1.6, z: 3 }, target: { x: 0, y: 1, z: 0 } },
    light: { position: { x: 1, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 2 },
    image: IMAGE,
  });
  const a1 = await saved1;
  if (a1.id !== 1 || a1.taskId !== 1) {
    throw new Error(`expected attempt id 1 task 1, got id=${a1.id} taskId=${a1.taskId}`);
  }

  const saved2 = once(expert, 'attempt:saved');
  novice.emit('attempt:submit', {
    camera: { position: { x: 1, y: 1.6, z: 3 }, target: { x: 0, y: 1, z: 0 } },
    light: { position: { x: 1, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 3.5 },
    image: IMAGE,
  });
  const a2 = await saved2;
  if (a2.id !== 2 || a2.taskId !== 1) {
    throw new Error(`expected attempt id 2 task 1, got id=${a2.id} taskId=${a2.taskId}`);
  }

  // 5. Expert publishes task 2; new submissions must belong to task 2.
  const publish2 = Promise.all([
    once(novice, 'task:start'),
    once(novice, 'task:published'),
  ]);
  expert.emit('task:publish', {
    camera: { position: { x: 2, y: 1.6, z: 4 }, target: { x: 0, y: 1, z: 0 } },
    light: { position: { x: 0, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 1 },
    referenceImage: IMAGE,
  });
  const [, taskEntry2] = await publish2;
  if (taskEntry2.id !== 2) {
    throw new Error(`expected task id 2, got ${taskEntry2.id}`);
  }

  const saved3 = once(expert, 'attempt:saved');
  novice.emit('attempt:submit', {
    taskId: 1, // student switched back to working on task 1
    camera: { position: { x: 2, y: 1.6, z: 4 }, target: { x: 0, y: 1, z: 0 } },
    light: { position: { x: 0, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 1 },
    image: IMAGE,
  });
  const a3 = await saved3;
  if (a3.taskId !== 1) {
    throw new Error(`expected attempt 3 to belong to task 1 (student choice), got taskId=${a3.taskId}`);
  }
  log('attempt routing by student selection OK');

  log('PASS');
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

setTimeout(() => {
  console.error('TIMEOUT');
  process.exit(1);
}, 8000);
