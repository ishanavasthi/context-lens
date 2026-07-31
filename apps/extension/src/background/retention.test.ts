import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type EventEnvelope } from '@contextlens/shared';
import { deleteEvents, enqueueEvent, readBatch } from './queue.js';
import { purgeLocalEvents } from './retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeEvent(eventId: string, ts: number): EventEnvelope {
  return {
    event_id: eventId,
    session_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    device_id: '00000000-0000-4000-8000-000000000001',
    type: 'click',
    ts,
    tz_offset: 0,
    seq: 1,
    schema_v: SCHEMA_VERSION,
    payload: {
      selector_path: 'body > button',
      tag: 'button',
      x_pct: 10,
      y_pct: 20,
      is_trusted: true,
    },
  };
}

beforeEach(async () => {
  const existing = await readBatch(1000);
  await deleteEvents(existing.map((event) => event.event_id));
});

describe('purgeLocalEvents', () => {
  it('removes only events older than the retention cutoff and returns an accurate count', async () => {
    const now = 10_000_000;
    await enqueueEvent(makeEvent('old-1', now - 31 * DAY_MS));
    await enqueueEvent(makeEvent('old-2', now - 40 * DAY_MS));
    await enqueueEvent(makeEvent('recent-1', now - 5 * DAY_MS));

    const removed = await purgeLocalEvents(30, now);

    expect(removed).toBe(2);
    const remaining = await readBatch(1000);
    expect(remaining.map((event) => event.event_id)).toEqual(['recent-1']);
  });

  it('returns zero and removes nothing when every event is within retention', async () => {
    const now = 10_000_000;
    await enqueueEvent(makeEvent('recent-1', now - DAY_MS));
    await enqueueEvent(makeEvent('recent-2', now - 2 * DAY_MS));

    const removed = await purgeLocalEvents(30, now);

    expect(removed).toBe(0);
    expect(await readBatch(1000)).toHaveLength(2);
  });
});
