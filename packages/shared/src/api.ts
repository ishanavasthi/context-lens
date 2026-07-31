import { z } from 'zod';

/** Every route lives under this prefix. Clients build URLs from these constants only. */
export const API_PREFIX = '/v1';

export const ROUTES = {
  health: `${API_PREFIX}/health`,
  eventsBatch: `${API_PREFIX}/events:batch`,
  events: `${API_PREFIX}/events`,
  screenshotsSign: `${API_PREFIX}/screenshots:sign`,
  export: `${API_PREFIX}/export`,
  data: `${API_PREFIX}/data`,
  consent: `${API_PREFIX}/consent`,
} as const;

/** Correlation id header. Echoed on every response, present on every log line. */
export const REQUEST_ID_HEADER = 'x-request-id';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeMs: z.number().int().nonnegative(),
  requestId: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
