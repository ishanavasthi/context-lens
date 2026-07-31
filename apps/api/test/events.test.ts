import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { connectionConfig, loadRootEnv } from '@contextlens/db';
import { errorEnvelopeSchema } from '@contextlens/shared';
import { createApp } from '../src/app.js';

// Load the root env so the tests run against whatever database the rest of the
// stack is pointed at. Without this they silently fall back to local Docker and a
// green run says nothing about the database actually in use.
loadRootEnv();
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://contextlens:contextlens@localhost:54329/contextlens';

const DEVICE_TOKEN = 'dev-device-token-0000000000000000';
const DEVICE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000001';

const pool = new Pool(connectionConfig(DATABASE_URL));
const app = createApp({ PORT: 8787, NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL }, '0.1.0', pool);

const sessionId = randomUUID();

function makeBatch() {
  return {
    device_id: DEVICE_ID,
    session_id: sessionId,
    events: [
      {
        event_id: randomUUID(),
        session_id: sessionId,
        device_id: DEVICE_ID,
        type: 'click' as const,
        ts: Date.now(),
        tz_offset: 0,
        seq: 0,
        schema_v: 1 as const,
        payload: {
          selector_path: 'body > button',
          tag: 'BUTTON',
          x_pct: 10,
          y_pct: 20,
          is_trusted: true,
        },
      },
      {
        event_id: randomUUID(),
        session_id: sessionId,
        device_id: DEVICE_ID,
        type: 'click' as const,
        ts: Date.now() + 1,
        tz_offset: 0,
        seq: 1,
        schema_v: 1 as const,
        payload: {
          selector_path: 'body > a',
          tag: 'A',
          x_pct: 30,
          y_pct: 40,
          is_trusted: true,
        },
      },
    ],
  };
}

const batch = makeBatch();

beforeAll(async () => {
  await pool.query(
    `insert into sessions (session_id, device_id, user_id, started_at, consent_scopes)
     values ($1, $2, $3, now(), $4)`,
    [sessionId, DEVICE_ID, USER_ID, ['interaction']],
  );
});

afterAll(async () => {
  await pool.query('delete from events where session_id = $1', [sessionId]);
  await pool.query('delete from sessions where session_id = $1', [sessionId]);
  await pool.end();
});

describe('POST /v1/events:batch', () => {
  it('returns 401 with an error envelope when Authorization is missing', async () => {
    const res = await app.request('/v1/events:batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  it('accepts a valid batch and inserts all rows', async () => {
    const res = await app.request('/v1/events:batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${DEVICE_TOKEN}`,
      },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ accepted: batch.events.length, duplicates: 0 });
  });

  it('is idempotent: reposting the same batch reports all as duplicates and inserts nothing new', async () => {
    const before = await pool.query('select count(*)::int as count from events where session_id = $1', [
      sessionId,
    ]);

    const res = await app.request('/v1/events:batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${DEVICE_TOKEN}`,
      },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ accepted: 0, duplicates: batch.events.length });

    const after = await pool.query('select count(*)::int as count from events where session_id = $1', [
      sessionId,
    ]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});

describe('GET /v1/events', () => {
  it('returns the inserted events for the device\'s user, newest first', async () => {
    const res = await app.request('/v1/events', {
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const ids = batch.events.map((e) => e.event_id);
    const returned = body.events.filter((e: { event_id: string }) => ids.includes(e.event_id));
    expect(returned).toHaveLength(batch.events.length);

    const timestamps = returned.map((e: { ts: string }) => new Date(e.ts).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });
});
