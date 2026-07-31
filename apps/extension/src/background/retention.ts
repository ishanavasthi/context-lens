import { deleteEvents, readBatch } from './queue.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function purgeLocalEvents(retentionDays: number, now: number = Date.now()): Promise<number> {
  const cutoff = now - retentionDays * DAY_MS;
  const all = await readBatch(Number.MAX_SAFE_INTEGER);
  const expired = all.filter((event) => event.ts < cutoff);
  if (expired.length === 0) {
    return 0;
  }
  await deleteEvents(expired.map((event) => event.event_id));
  return expired.length;
}
