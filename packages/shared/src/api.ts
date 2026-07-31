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
  summary: `${API_PREFIX}/summary`,
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

/**
 * Aggregates behind the timeline view. Computed in the database rather than by pulling
 * every row to the client, because the point of the view is to make a long history
 * readable and shipping that history to render it defeats the purpose.
 */
export const summaryResponseSchema = z.object({
  totals: z.object({
    events: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    screenshots: z.number().int().nonnegative(),
  }),
  byDomain: z.array(
    z.object({
      host: z.string(),
      events: z.number().int().nonnegative(),
      dwellMs: z.number().int().nonnegative(),
    }),
  ),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      startedAt: z.string(),
      lastEventAt: z.string(),
      events: z.number().int().nonnegative(),
    }),
  ),
});

export type SummaryResponse = z.infer<typeof summaryResponseSchema>;
