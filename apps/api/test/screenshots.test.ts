import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { connectionConfig, loadRootEnv } from '@contextlens/db';
import { errorEnvelopeSchema, screenshotSignResponseSchema, SCREENSHOT_LIMITS } from '@contextlens/shared';
import { createApp } from '../src/app.js';

/**
 * These tests sign against real object storage. Continuous integration has no storage
 * credentials, so they skip there rather than fail. Skipping is announced by the runner,
 * which keeps the gap visible instead of quietly reducing what the suite covers.
 */
const STORAGE_CONFIGURED = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

loadRootEnv();
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://contextlens:contextlens@localhost:54329/contextlens';

const DEVICE_TOKEN = 'dev-device-token-0000000000000000';

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

function makeSha256(): string {
  return randomUUID().replace(/-/g, '').padEnd(64, '0');
}

function makeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sha256: makeSha256(),
    bytes: 1024,
    width: 1280,
    height: 800,
    dpr: 2,
    trigger: 'navigation',
    ...overrides,
  };
}

const createdShas: string[] = [];

afterAll(async () => {
  if (createdShas.length) {
    await pool.query('delete from screenshots where screenshot_id = any($1)', [createdShas]);
  }
  await pool.end();
});

describe.skipIf(!STORAGE_CONFIGURED)('POST /v1/screenshots:sign', () => {
  it('returns 401 without a device token', async () => {
    const res = await app.request('/v1/screenshots:sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeRequest()),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  it('rejects a malformed sha256 with 400 and the error envelope', async () => {
    const res = await app.request('/v1/screenshots:sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${DEVICE_TOKEN}` },
      body: JSON.stringify(makeRequest({ sha256: 'not-a-hash' })),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  it('rejects a bytes value above SCREENSHOT_LIMITS.maxBytes', async () => {
    const res = await app.request('/v1/screenshots:sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${DEVICE_TOKEN}` },
      body: JSON.stringify(makeRequest({ bytes: SCREENSHOT_LIMITS.maxBytes + 1 })),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  it('returns 200 with an absolute uploadUrl and records the screenshot row', async () => {
    const request = makeRequest();
    createdShas.push(request.sha256);

    const res = await app.request('/v1/screenshots:sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${DEVICE_TOKEN}` },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(screenshotSignResponseSchema.parse(body)).toEqual(body);
    expect(body.uploadUrl.startsWith('http')).toBe(true);

    const row = await pool.query('select screenshot_id from screenshots where screenshot_id = $1', [
      request.sha256,
    ]);
    expect(row.rowCount).toBe(1);
  });
});
