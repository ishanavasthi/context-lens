import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type EventEnvelope } from '@contextlens/shared';
import { deleteEvents, enqueueEvent, queueSize, readBatch } from './queue.js';

function makeEvent(eventId: string, seq: number): EventEnvelope {
  return {
    event_id: eventId,
    session_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    device_id: '00000000-0000-4000-8000-000000000001',
    type: 'click',
    ts: Date.now(),
    tz_offset: 0,
    seq,
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

describe('queue', () => {
  it('reflects the enqueued count in queueSize', async () => {
    await enqueueEvent(makeEvent('event-1', 1));
    await enqueueEvent(makeEvent('event-2', 2));

    expect(await queueSize()).toBe(2);
  });

  it('removes exactly the drained rows on a successful drain', async () => {
    await enqueueEvent(makeEvent('event-1', 1));
    await enqueueEvent(makeEvent('event-2', 2));
    await enqueueEvent(makeEvent('event-3', 3));

    const batch = await readBatch(2);
    expect(batch).toHaveLength(2);
    await deleteEvents(batch.map((event) => event.event_id));

    expect(await queueSize()).toBe(1);
    const remaining = await readBatch(10);
    expect(remaining.map((event) => event.event_id)).not.toEqual(
      expect.arrayContaining(batch.map((event) => event.event_id)),
    );
  });

  it('leaves every row in place after a failed drain', async () => {
    await enqueueEvent(makeEvent('event-1', 1));
    await enqueueEvent(makeEvent('event-2', 2));

    const batch = await readBatch(10);
    expect(batch).toHaveLength(2);
    // Simulate a failed POST: no deleteEvents call happens.

    expect(await queueSize()).toBe(2);
  });
});
