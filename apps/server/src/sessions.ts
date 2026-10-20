import { randomInt } from 'node:crypto';

import type {
  Attempt,
  AttemptFeedback,
  CameraState,
  LightState,
  Role,
  SessionMeta,
  SessionPhase,
  TaskEntry,
  TaskTarget,
} from '@expertise-sharing/shared';

/**
 * In-memory session store. Sessions live for the life of the server process;
 * there is no database. A session is deleted once everyone has left.
 */

// No I/O, 0 or 1 in join codes to avoid transcription mistakes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

/** A role's most recently streamed scene state. */
export interface LiveState {
  camera: CameraState;
  light: LightState;
}

export interface Session {
  code: string;
  phase: SessionPhase;
  submitted: boolean;
  /** Role → socket ID currently claiming it. */
  members: Partial<Record<Role, string>>;
  /** Live state per role, streamed with `state:update`. */
  live: Partial<Record<Role, LiveState>>;
  /** Target states stay server-side and remain available for prior task attempts. */
  taskTargets: Map<number, TaskTarget>;
  /** Data URL of the reference render for the active task. */
  referenceImage: string | null;
  /** Published task history — cleaned of attempts but never wiped per publish. */
  tasks: TaskEntry[];
  currentTaskId: number | null;
  nextTaskId: number;
  /** All submitted attempts across tasks for this session. */
  attempts: Attempt[];
  nextAttemptId: number;
  /** Latest expert feedback per submission. */
  attemptFeedback: Map<number, AttemptFeedback>;
}

const sessions = new Map<string, Session>();

function newCode(): string {
  let code = '';
  do {
    code = Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    ).join('');
  } while (sessions.has(code));
  return code;
}

export function newSession(): Session {
  const session: Session = {
    code: newCode(),
    phase: 'lobby',
    submitted: false,
    members: {},
    live: {},
    taskTargets: new Map(),
    referenceImage: null,
    tasks: [],
    currentTaskId: null,
    nextTaskId: 1,
    attempts: [],
    nextAttemptId: 1,
    attemptFeedback: new Map(),
  };
  sessions.set(session.code, session);
  return session;
}

export function getSession(code: string): Session | undefined {
  return sessions.get(code.trim().toUpperCase());
}

export function getSessionBySocket(socketId: string): Session | undefined {
  for (const session of sessions.values()) {
    for (const holder of Object.values(session.members)) {
      if (holder === socketId) return session;
    }
  }
  return undefined;
}

/** Bind a role to a socket. Fails if the role is already held by someone else. */
export function claimRole(session: Session, role: Role, socketId: string): boolean {
  const holder = session.members[role];
  if (holder && holder !== socketId) return false;
  session.members[role] = socketId;
  return true;
}

/** Release any role held by the given socket. */
export function releaseMember(session: Session, socketId: string): void {
  for (const [role, holder] of Object.entries(session.members) as Array<[Role, string]>) {
    if (holder === socketId) {
      delete session.members[role];
      delete session.live[role];
    }
  }
}

export function dropIfEmpty(session: Session): boolean {
  if (session.members.expert && session.members.novice) return false;
  sessions.delete(session.code);
  return true;
}

export function sessionMeta(session: Session): SessionMeta {
  return {
    code: session.code,
    phase: session.phase,
    submitted: session.submitted,
    expertPresent: Boolean(session.members.expert),
    novicePresent: Boolean(session.members.novice),
  };
}
