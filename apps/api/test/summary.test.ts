import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { connectionConfig, loadRootEnv } from '@contextlens/db';
import { errorEnvelopeSchema, summaryResponseSchema } from '@contextlens/shared';
import { createApp } from '../src/app.js';

loadRootEnv();
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://contextlens:contextlens@localhost:54329/contextlens';

const pool = new Pool(connectionConfig(DATABASE_URL));
const app = createApp({ PORT: 8787, NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL }, '0.1.0', pool);

function tokenFor(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

async function createFixtureDevice(): Promise<{ userId: string; deviceId: string; token: string }> {
  const userId = randomUUID();
  const deviceId = randomUUID();
  const token = `test-token-${randomUUID()}`;
  await pool.query('insert into users (user_id, email) values ($1, $2)', [userId, `${userId}@example.com`]);
  await pool.query(
    'insert into devices (device_id, user_id, user_agent, platform, token_hash) values ($1, $2, $3, $4, $5)',
    [deviceId, userId, 'vitest', 'test', tokenFor(token)],
  );
  return { userId, deviceId, token };
}

async function createFixtureUrl(host: string): Promise<number> {
  const hash = createHash('sha256').update(`${host}-${randomUUID()}`).digest();
  const result = await pool.query(
    `insert into urls (url_hash, host) values ($1, $2) returning url_id`,
    [hash, host],
  );
  return result.rows[0].url_id;
}

async function createFixtureSession(userId: string, deviceId: string): Promise<string> {
  const sessionId = randomUUID();
  await pool.query(
    `insert into sessions (session_id, device_id, user_id, started_at, consent_scopes)
     values ($1, $2, $3, now(), $4)`,
    [sessionId, deviceId, userId, ['interaction']],
  );
  return sessionId;
}

async function insertEvent(params: {
  eventId: string;
  sessionId: string;
  userId: string;
  type: string;
  ts: Date;
  seq: number;
  urlId?: number | null;
  payload?: unknown;
}): Promise<void> {
  await pool.query(
    `insert into events (event_id, session_id, user_id, type, ts, seq, url_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.eventId,
      params.sessionId,
      params.userId,
      params.type,
      params.ts,
      params.seq,
      params.urlId ?? null,
      JSON.stringify(params.payload ?? {}),
    ],
  );
}

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const userId of createdUserIds) {
    await pool.query('delete from events where user_id = $1', [userId]);
    await pool.query('delete from sessions where user_id = $1', [userId]);
    await pool.query('delete from devices where user_id = $1', [userId]);
    await pool.query('delete from users where user_id = $1', [userId]);
  }
  await pool.end();
});

describe('GET /v1/summary', () => {
  it('returns 401 without a device token', async () => {
    const res = await app.request('/v1/summary');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  it('parses against summaryResponseSchema, sums dwell per host, and groups null url_id under (unknown)', async () => {
    const fixture = await createFixtureDevice();
    createdUserIds.push(fixture.userId);
    const sessionId = await createFixtureSession(fixture.userId, fixture.deviceId);

    const urlId = await createFixtureUrl('example.com');
    const now = new Date('2026-06-01T12:00:00Z');

    await insertEvent({
      eventId: `${sessionId}-1`,
      sessionId,
      userId: fixture.userId,
      type: 'page_view_end',
      ts: now,
      seq: 0,
      urlId,
      payload: { dwell_ms: 1000, engaged_ms: 500, max_scroll_pct: 50 },
    });
    await insertEvent({
      eventId: `${sessionId}-2`,
      sessionId,
      userId: fixture.userId,
      type: 'page_view_end',
      ts: new Date(now.getTime() + 1000),
      seq: 1,
      urlId,
      payload: { dwell_ms: 2000, engaged_ms: 1000, max_scroll_pct: 80 },
    });
    await insertEvent({
      eventId: `${sessionId}-3`,
      sessionId,
      userId: fixture.userId,
      type: 'page_view_end',
      ts: new Date(now.getTime() + 2000),
      seq: 2,
      urlId: null,
      payload: { dwell_ms: 500, engaged_ms: 200, max_scroll_pct: 30 },
    });

    const res = await app.request('/v1/summary', {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(summaryResponseSchema.parse(body)).toEqual(body);

    expect(body.totals.events).toBe(3);
    expect(body.totals.sessions).toBe(1);

    const exampleRow = body.byDomain.find((row: { host: string }) => row.host === 'example.com');
    expect(exampleRow).toMatchObject({ host: 'example.com', events: 2, dwellMs: 3000 });

    const unknownRow = body.byDomain.find((row: { host: string }) => row.host === '(unknown)');
    expect(unknownRow).toMatchObject({ host: '(unknown)', events: 1, dwellMs: 500 });

    const sessionRow = body.sessions.find((row: { sessionId: string }) => row.sessionId === sessionId);
    expect(sessionRow).toMatchObject({ sessionId, events: 3 });
    expect(new Date(sessionRow.startedAt).getTime()).toBe(now.getTime());
    expect(new Date(sessionRow.lastEventAt).getTime()).toBe(now.getTime() + 2000);
  });

  it('narrows totals to the from and to window', async () => {
    const fixture = await createFixtureDevice();
    createdUserIds.push(fixture.userId);
    const sessionId = await createFixtureSession(fixture.userId, fixture.deviceId);

    const inWindow = new Date('2026-06-10T12:00:00Z');
    const outOfWindow = new Date('2026-06-20T12:00:00Z');

    await insertEvent({
      eventId: `${sessionId}-in`,
      sessionId,
      userId: fixture.userId,
      type: 'click',
      ts: inWindow,
      seq: 0,
    });
    await insertEvent({
      eventId: `${sessionId}-out`,
      sessionId,
      userId: fixture.userId,
      type: 'click',
      ts: outOfWindow,
      seq: 1,
    });

    const res = await app.request(
      `/v1/summary?from=${encodeURIComponent('2026-06-09T00:00:00Z')}&to=${encodeURIComponent('2026-06-11T00:00:00Z')}`,
      { headers: { authorization: `Bearer ${fixture.token}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.events).toBe(1);
  });
});
