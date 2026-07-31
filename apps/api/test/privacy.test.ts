import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { connectionConfig, loadRootEnv } from '@contextlens/db';
import { deleteResultSchema, errorEnvelopeSchema } from '@contextlens/shared';
import { createApp } from '../src/app.js';
import { purgeExpired } from '../src/repo/privacy.js';

loadRootEnv();
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://contextlens:contextlens@localhost:54329/contextlens';

const pool = new Pool(connectionConfig(DATABASE_URL));
const app = createApp(
  {
    PORT: 8787,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  '0.1.0',
  pool,
);

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

async function deleteFixtureUser(userId: string): Promise<void> {
  await pool.query('delete from consent_audit where user_id = $1', [userId]);
  await pool.query('delete from users where user_id = $1', [userId]);
}

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const userId of createdUserIds) {
    await deleteFixtureUser(userId);
  }
  await pool.end();
});

describe('GET /v1/export', () => {
  it('returns 401 without a device token', async () => {
    const res = await app.request(`/v1/export`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  it('streams ndjson whose event lines equal the user\'s event count', async () => {
    const fixture = await createFixtureDevice();
    createdUserIds.push(fixture.userId);

    const sessionId = randomUUID();
    await pool.query(
      `insert into sessions (session_id, device_id, user_id, started_at, consent_scopes)
       values ($1, $2, $3, now(), $4)`,
      [sessionId, fixture.deviceId, fixture.userId, ['interaction']],
    );

    const eventCount = 3;
    for (let i = 0; i < eventCount; i++) {
      await pool.query(
        `insert into events (event_id, session_id, user_id, type, ts, seq, payload)
         values ($1, $2, $3, 'click', now(), $4, '{}')`,
        [`${sessionId}-evt-${i}`, sessionId, fixture.userId, i],
      );
    }

    const res = await app.request('/v1/export', {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(res.headers.get('content-disposition')).toContain('attachment');

    const text = await res.text();
    const lines = text.trim().split('\n').map((line) => JSON.parse(line));

    const meta = lines[0];
    expect(meta.kind).toBe('meta');
    expect(meta.user_id).toBe(fixture.userId);
    expect(meta.counts.events).toBe(eventCount);

    const eventLines = lines.filter((line) => line.kind === 'event');
    expect(eventLines).toHaveLength(eventCount);
  });
});

describe('DELETE /v1/data', () => {
  it('returns 401 without a device token', async () => {
    const res = await app.request('/v1/data', { method: 'DELETE' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  it('removes the rows and returns accurate counts', async () => {
    const fixture = await createFixtureDevice();
    createdUserIds.push(fixture.userId);

    const sessionId = randomUUID();
    await pool.query(
      `insert into sessions (session_id, device_id, user_id, started_at, consent_scopes)
       values ($1, $2, $3, now(), $4)`,
      [sessionId, fixture.deviceId, fixture.userId, ['interaction']],
    );
    await pool.query(
      `insert into events (event_id, session_id, user_id, type, ts, seq, payload)
       values ($1, $2, $3, 'click', now(), 0, '{}')`,
      [`${sessionId}-evt-0`, sessionId, fixture.userId],
    );
    const screenshotId = randomUUID().replace(/-/g, '').padEnd(64, '0');
    await pool.query(
      `insert into screenshots (screenshot_id, event_id, user_id, storage_path, width, height, dpr, bytes, sha256)
       values ($1, null, $2, $3, 100, 100, 1, 10, $4)`,
      [screenshotId, fixture.userId, `${fixture.userId}/2026-01-01/${screenshotId}.webp`, Buffer.from(screenshotId, 'hex')],
    );

    const res = await app.request('/v1/data', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(deleteResultSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({ events: 1, sessions: 1, screenshots: 1 });
    expect(body.storageObjects).toBeGreaterThanOrEqual(0);

    const remainingEvents = await pool.query('select count(*)::int as count from events where user_id = $1', [
      fixture.userId,
    ]);
    const remainingSessions = await pool.query('select count(*)::int as count from sessions where user_id = $1', [
      fixture.userId,
    ]);
    const remainingScreenshots = await pool.query(
      'select count(*)::int as count from screenshots where user_id = $1',
      [fixture.userId],
    );
    expect(remainingEvents.rows[0].count).toBe(0);
    expect(remainingSessions.rows[0].count).toBe(0);
    expect(remainingScreenshots.rows[0].count).toBe(0);
  });

  it('returns zeroes rather than failing on an already empty account', async () => {
    const fixture = await createFixtureDevice();
    createdUserIds.push(fixture.userId);

    const res = await app.request('/v1/data', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ events: 0, sessions: 0, screenshots: 0, storageObjects: 0 });
  });
});

describe('POST /v1/consent', () => {
  it('inserts an audit row', async () => {
    const fixture = await createFixtureDevice();
    createdUserIds.push(fixture.userId);

    const res = await app.request('/v1/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${fixture.token}` },
      body: JSON.stringify({ from: ['navigation'], to: ['navigation', 'interaction'], source: 'settings_page' }),
    });
    expect(res.status).toBe(200);

    const row = await pool.query(
      'select user_id, device_id, from_scopes, to_scopes, source from consent_audit where user_id = $1',
      [fixture.userId],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]).toMatchObject({
      user_id: fixture.userId,
      device_id: fixture.deviceId,
      from_scopes: ['navigation'],
      to_scopes: ['navigation', 'interaction'],
      source: 'settings_page',
    });
  });
});

describe('purgeExpired', () => {
  it('removes only rows older than the cutoff', async () => {
    const fixture = await createFixtureDevice();
    createdUserIds.push(fixture.userId);

    const sessionId = randomUUID();
    await pool.query(
      `insert into sessions (session_id, device_id, user_id, started_at, consent_scopes)
       values ($1, $2, $3, now(), $4)`,
      [sessionId, fixture.deviceId, fixture.userId, ['interaction']],
    );

    // A retention window far longer than the seeded demo data's age (seeded 2026-07-01)
    // so this purge cannot touch it, while the fixture "old" event is old enough to be
    // caught regardless of when this test runs.
    const retentionDays = 3650;
    const oldEventId = `${sessionId}-old`;
    const freshEventId = `${sessionId}-fresh`;
    await pool.query(
      `insert into events (event_id, session_id, user_id, type, ts, seq, payload)
       values ($1, $2, $3, 'click', now() - interval '10000 days', 0, '{}')`,
      [oldEventId, sessionId, fixture.userId],
    );
    await pool.query(
      `insert into events (event_id, session_id, user_id, type, ts, seq, payload)
       values ($1, $2, $3, 'click', now(), 1, '{}')`,
      [freshEventId, sessionId, fixture.userId],
    );

    const removed = await purgeExpired(pool, retentionDays);
    expect(removed).toBeGreaterThanOrEqual(1);

    const old = await pool.query('select 1 from events where event_id = $1', [oldEventId]);
    const fresh = await pool.query('select 1 from events where event_id = $1', [freshEventId]);
    expect(old.rowCount).toBe(0);
    expect(fresh.rowCount).toBe(1);
  });
});
