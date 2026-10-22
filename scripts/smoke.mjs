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
    scene: 'shelf-wall',
  });
  const [start1] = await publish1;
  if (start1.taskId !== 1) {
    throw new Error(`expected task:start id 1, got ${start1.taskId}`);
  }
  if (start1.scene !== 'shelf-wall') {
    throw new Error(`expected task:start scene shelf-wall, got ${start1.scene}`);
  }
  log('novice received task:start, reference image bytes =', start1.referenceImage.length);

  // Novice hints are opt-in and do not expose the target state.
  const hintResult = once(novice, 'hint:result');
  novice.emit('hint:request', {
    taskId: 1,
    snapshot: {
      camera: { position: { x: 8, y: 1.6, z: 3 }, target: { x: 0, y: 1, z: 0 } },
      light: { position: { x: 8, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 3.5 },
    },
  });
  const hint = await hintResult;
  if (!hint || hint.component !== 'camera-position') {
    throw new Error(`expected camera-position hint, got ${JSON.stringify(hint)}`);
  }

  // 4. Novice submits attempt 1 and 2 for task 1.
  const saved1 = once(expert, 'attempt:saved');
  const submissionChat1 = once(expert, 'chat:message');
  const review1 = once(expert, 'attempt:review');
  let noviceReceivedReview = false;
  novice.once('attempt:review', () => {
    noviceReceivedReview = true;
  });
  novice.emit('attempt:submit', {
    camera: { position: { x: 0, y: 1.6, z: 3 }, target: { x: 0, y: 1, z: 0 } },
    light: { position: { x: 1, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 2 },
    image: IMAGE,
  });
  const a1 = await saved1;
  const submissionMessage1 = await submissionChat1;
  const r1 = await review1;
  if (a1.id !== 1 || a1.taskId !== 1) {
    throw new Error(`expected attempt id 1 task 1, got id=${a1.id} taskId=${a1.taskId}`);
  }
  if (a1.scene !== 'shelf-wall') {
    throw new Error(`expected attempt scene shelf-wall (from task), got ${a1.scene}`);
  }
  if (
    submissionMessage1.from !== 'novice' ||
    submissionMessage1.text !== `Submitted Attempt ${a1.id}.`
  ) {
    throw new Error(`unexpected submission chat message: ${JSON.stringify(submissionMessage1)}`);
  }
  if (
    r1.attemptId !== a1.id ||
    r1.diff.lightIntensityDifference !== 0.5 ||
    r1.suggestions.length !== 3 ||
    new Set(r1.suggestions).size !== r1.suggestions.length
  ) {
    throw new Error(`unexpected expert review: ${JSON.stringify(r1)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (noviceReceivedReview) {
    throw new Error('attempt review must not be sent to the novice');
  }

  const noviceFeedback = once(novice, 'feedback:new');
  const expertFeedback = once(expert, 'feedback:saved');
  const expertFeedbackChat = once(expert, 'chat:message');
  const noviceFeedbackChat = once(novice, 'chat:message');
  expert.emit('feedback:send', {
    attemptId: a1.id,
    text: 'Good framing. Try reducing the brightness slightly.',
  });
  const [feedbackForNovice, feedbackSaved, expertChatNotice, noviceChatNotice] = await Promise.all([
    noviceFeedback,
    expertFeedback,
    expertFeedbackChat,
    noviceFeedbackChat,
  ]);
  if (
    feedbackForNovice.attemptId !== a1.id ||
    feedbackForNovice.text !== 'Good framing. Try reducing the brightness slightly.' ||
    !feedbackForNovice.unread ||
    feedbackSaved.attemptId !== a1.id
  ) {
    throw new Error(`unexpected attempt feedback: ${JSON.stringify(feedbackForNovice)}`);
  }
  if (
    expertChatNotice.from !== 'expert' ||
    expertChatNotice.text !== `Left feedback on Attempt ${a1.id}.` ||
    JSON.stringify(noviceChatNotice) !== JSON.stringify(expertChatNotice)
  ) {
    throw new Error(`unexpected feedback chat announcement: ${JSON.stringify(expertChatNotice)}`);
  }
  novice.emit('feedback:read', a1.id);

  const chat = once(expert, 'chat:message');
  novice.emit('chat:message', '  Thanks for the hint!  ');
  const chatMessage = await chat;
  if (chatMessage.from !== 'novice' || chatMessage.text !== 'Thanks for the hint!') {
    throw new Error(`unexpected chat message: ${JSON.stringify(chatMessage)}`);
  }

  const saved2 = once(expert, 'attempt:saved');
  const submissionChat2 = once(expert, 'chat:message');
  novice.emit('attempt:submit', {
    camera: { position: { x: 1, y: 1.6, z: 3 }, target: { x: 0, y: 1, z: 0 } },
    light: { position: { x: 1, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 3.5 },
    image: IMAGE,
  });
  const a2 = await saved2;
  const submissionMessage2 = await submissionChat2;
  if (a2.id !== 2 || a2.taskId !== 1) {
    throw new Error(`expected attempt id 2 task 1, got id=${a2.id} taskId=${a2.taskId}`);
  }
  if (
    submissionMessage2.from !== 'novice' ||
    submissionMessage2.text !== `Submitted Attempt ${a2.id}.`
  ) {
    throw new Error(`unexpected submission chat message: ${JSON.stringify(submissionMessage2)}`);
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
    scene: 'arch-reveal',
  });
  const [start2, taskEntry2] = await publish2;
  if (taskEntry2.id !== 2) {
    throw new Error(`expected task id 2, got ${taskEntry2.id}`);
  }
  if (taskEntry2.scene !== 'arch-reveal' || start2.scene !== 'arch-reveal') {
    throw new Error(`expected arch-reveal scene, got task=${taskEntry2.scene} start=${start2.scene}`);
  }
  if (start2.taskId !== 2) {
    throw new Error(`expected task:start id 2, got ${start2.taskId}`);
  }

  const saved3 = once(expert, 'attempt:saved');
  const submissionChat3 = once(expert, 'chat:message');
  const review3 = once(expert, 'attempt:review');
  novice.emit('attempt:submit', {
    taskId: 1, // student switched back to working on task 1
    camera: { position: { x: 2, y: 1.6, z: 4 }, target: { x: 0, y: 1, z: 0 } },
    light: { position: { x: 0, y: 2, z: 2 }, target: { x: 0, y: 1, z: 0 }, intensity: 1 },
    image: IMAGE,
  });
  const a3 = await saved3;
  const submissionMessage3 = await submissionChat3;
  const r3 = await review3;
  if (
    submissionMessage3.from !== 'novice' ||
    submissionMessage3.text !== `Submitted Attempt ${a3.id}.`
  ) {
    throw new Error(`unexpected submission chat message: ${JSON.stringify(submissionMessage3)}`);
  }
  if (a3.taskId !== 1) {
    throw new Error(`expected attempt 3 to belong to task 1 (student choice), got taskId=${a3.taskId}`);
  }
  if (r3.taskId !== 1 || r3.diff.lightPositionDistance !== 1) {
    throw new Error(`expected task 1-specific review, got ${JSON.stringify(r3)}`);
  }
  log('task routing, novice hints, and expert-only reviews OK');

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
