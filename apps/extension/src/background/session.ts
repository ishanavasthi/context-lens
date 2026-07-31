import { ulid } from 'ulid';

const DEVICE_ID = '00000000-0000-4000-8000-000000000001';
const DEVICE_ID_KEY = 'device_id';
const SESSION_KEY = 'session';

/**
 * A new session begins after this much inactivity. It is deliberately far longer than a
 * service worker lifetime: the worker is terminated after seconds of idle, and if every
 * restart began a new session then one afternoon of browsing would shatter into hundreds
 * of them, each starting at an arbitrary sequence number.
 */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

export interface StoredSession {
  id: string;
  startedAt: number;
  lastEventAt: number;
  seq: number;
}

export async function getDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
  if (typeof stored[DEVICE_ID_KEY] === 'string') {
    return stored[DEVICE_ID_KEY];
  }
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: DEVICE_ID });
  return DEVICE_ID;
}

function isUsable(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<StoredSession>;
  return (
    typeof session.id === 'string' &&
    typeof session.startedAt === 'number' &&
    typeof session.lastEventAt === 'number' &&
    typeof session.seq === 'number'
  );
}

/**
 * Allocates the session and the sequence number for one event, together.
 *
 * The counter lives inside the session record rather than beside it, so a sequence
 * number can never be paired with a different session than the one it was issued under.
 * That pairing is what lets a gap in the sequence mean an event was lost, which is the
 * only signal available for detecting drops caused by worker termination.
 */
/**
 * Serialises allocation.
 *
 * The body reads the counter, awaits, then writes it back. Two calls that interleave at
 * that await both read the same value and both write the same successor, handing out a
 * duplicate. It is not hypothetical: a real browsing session produced 228 events with
 * only 223 distinct sequence numbers, because a click, a navigation and a scroll can be
 * allocated concurrently. A duplicate is worse than a gap, since gap detection is the
 * only signal for events lost to worker termination and reuse quietly corrupts it.
 *
 * A promise chain is sufficient because the worker is single threaded and only one
 * instance runs at a time, so there is no cross instance race to guard against.
 */
let allocationChain: Promise<unknown> = Promise.resolve();

export function allocateEventIdentity(
  now: number = Date.now(),
): Promise<{ sessionId: string; seq: number }> {
  const next = allocationChain.then(() => allocateExclusively(now));
  // Keep the chain alive even if one allocation rejects, otherwise a single failure
  // would wedge every later allocation behind a rejected promise.
  allocationChain = next.catch(() => undefined);
  return next;
}

async function allocateExclusively(
  now: number,
): Promise<{ sessionId: string; seq: number }> {
  const stored = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
  const previous = isUsable(stored) ? stored : null;
  const expired = previous === null || now - previous.lastEventAt > SESSION_IDLE_MS;

  const session: StoredSession = expired
    ? { id: ulid(), startedAt: now, lastEventAt: now, seq: 1 }
    : { ...previous, lastEventAt: now, seq: previous.seq + 1 };

  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return { sessionId: session.id, seq: session.seq };
}

/** The current session id, without consuming a sequence number. */
export async function currentSessionId(now: number = Date.now()): Promise<string> {
  const stored = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
  if (isUsable(stored) && now - stored.lastEventAt <= SESSION_IDLE_MS) {
    return stored.id;
  }
  const session: StoredSession = { id: ulid(), startedAt: now, lastEventAt: now, seq: 0 };
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session.id;
}
