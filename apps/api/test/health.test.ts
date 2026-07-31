import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, healthResponseSchema, REQUEST_ID_HEADER } from '@contextlens/shared';
import { createApp } from '../src/app.js';

const app = createApp({ PORT: 8787, NODE_ENV: 'test', LOG_LEVEL: 'error' }, '0.1.0');

describe('GET /v1/health', () => {
  it('returns 200 with a body matching healthResponseSchema', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('echoes the x-request-id header, generating one if absent', async () => {
    const res = await app.request('/v1/health');
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();

    const inboundId = 'test-request-id-123';
    const res2 = await app.request('/v1/health', {
      headers: { [REQUEST_ID_HEADER]: inboundId },
    });
    expect(res2.headers.get(REQUEST_ID_HEADER)).toBe(inboundId);
  });
});

describe('unknown route', () => {
  it('returns 404 with a body matching errorEnvelopeSchema', async () => {
    const res = await app.request('/v1/does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });
});
