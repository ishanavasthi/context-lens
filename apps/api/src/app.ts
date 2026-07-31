import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  ApiError,
  ERROR_CODES,
  eventBatchResultSchema,
  eventBatchSchema,
  MAX_EVENTS_PER_BATCH,
  parseEvent,
  REQUEST_ID_HEADER,
  ROUTES,
  toErrorEnvelope,
} from '@contextlens/shared';
import type { Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { deviceAuth, type AuthVariables } from './auth.js';
import { insertEventsBatch, listEvents } from './repo/events.js';
import { ensureSession } from './repo/sessions.js';
import { decodeCursor, encodeCursor } from './cursor.js';

type Variables = AuthVariables & {
  requestId: string;
  logger: Logger;
};

export function createApp(
  config: Config,
  version: string,
  pool: Pool = new Pool({ connectionString: config.DATABASE_URL }),
): Hono<{ Variables: Variables }> {
  const baseLogger = createLogger(config.LOG_LEVEL);
  const app = new Hono<{ Variables: Variables }>();
  const startedAt = Date.now();

  app.use('*', async (c, next) => {
    const requestId = c.req.header(REQUEST_ID_HEADER) ?? crypto.randomUUID();
    const logger = createLogger(config.LOG_LEVEL, { requestId });
    c.set('requestId', requestId);
    c.set('logger', logger);
    await next();
    c.header(REQUEST_ID_HEADER, requestId);
    logger.info('request handled', { path: c.req.path, method: c.req.method, status: c.res.status });
  });

  app.get(ROUTES.health, (c) => {
    return c.json({
      status: 'ok' as const,
      version,
      uptimeMs: Date.now() - startedAt,
      requestId: c.get('requestId'),
    });
  });

  app.post(ROUTES.eventsBatch, deviceAuth(pool), async (c) => {
    const body = await c.req.json().catch(() => {
      throw new ApiError(ERROR_CODES.BAD_REQUEST, 'Invalid JSON body');
    });

    const rawEvents = (body as { events?: unknown }).events;
    if (Array.isArray(rawEvents) && rawEvents.length > MAX_EVENTS_PER_BATCH) {
      throw new ApiError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        `Batch exceeds maximum of ${MAX_EVENTS_PER_BATCH} events`,
      );
    }

    const batch = eventBatchSchema.parse(body);
    const events = batch.events.map(parseEvent);
    const userId = c.get('userId');

    // Ensure every session referenced anywhere in the batch, not just the one named on
    // the envelope. A batch is drained from a durable queue that can outlive a session
    // boundary, so it may legitimately carry events from more than one. Ensuring only
    // the envelope's session would leave the rest failing their foreign key.
    //
    // The device id comes from the authenticated device, never from the body, so a
    // client cannot attribute events to someone else's device.
    const deviceId = c.get('deviceId');
    const sessionIds = new Set<string>([batch.session_id, ...events.map((e) => e.session_id)]);
    for (const sessionId of sessionIds) {
      const start = events.find((e) => e.session_id === sessionId && e.type === 'session_start');
      await ensureSession(pool, {
        sessionId,
        deviceId,
        userId,
        consentScopes: (start?.payload as { consent_scopes?: string[] } | undefined)?.consent_scopes,
      });
    }

    const result = await insertEventsBatch(pool, userId, events);
    return c.json(eventBatchResultSchema.parse(result));
  });

  app.get(ROUTES.events, deviceAuth(pool), async (c) => {
    const userId = c.get('userId');
    const query = c.req.query();

    const requestedLimit = query.limit ? Number(query.limit) : 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) {
      throw new ApiError(ERROR_CODES.BAD_REQUEST, 'limit must be a positive integer');
    }
    const limit = Math.min(requestedLimit, 500);

    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new ApiError(ERROR_CODES.BAD_REQUEST, 'from and to must be valid timestamps');
    }

    const rows = await listEvents(pool, {
      userId,
      type: query.type,
      from,
      to,
      cursor,
      limit: limit + 1,
    });

    const events = rows.slice(0, limit);
    const last = events.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ ts: last.ts.toISOString(), eventId: last.event_id })
        : null;

    return c.json({ events, nextCursor });
  });

  app.notFound((c) => {
    const requestId = c.get('requestId');
    const error = new ApiError(ERROR_CODES.NOT_FOUND, 'Route not found');
    return c.json(toErrorEnvelope(error, requestId), error.status as ContentfulStatusCode);
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId');
    const logger = c.get('logger') ?? baseLogger;
    const apiError =
      err instanceof ApiError
        ? err
        : err instanceof ZodError
          ? new ApiError(ERROR_CODES.BAD_REQUEST, 'Invalid request body', err.issues)
          : new ApiError(ERROR_CODES.INTERNAL, 'Internal server error');
    // Log the underlying cause server side. The response body deliberately
    // carries only the sanitised envelope, so without this an unexpected error
    // is undiagnosable: all anyone sees is "Internal server error".
    logger.error(apiError.message, {
      requestId,
      code: apiError.code,
      cause: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json(toErrorEnvelope(apiError, requestId), apiError.status as ContentfulStatusCode);
  });

  return app;
}
