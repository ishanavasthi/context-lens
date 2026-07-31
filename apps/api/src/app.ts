import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  ApiError,
  ERROR_CODES,
  REQUEST_ID_HEADER,
  ROUTES,
  toErrorEnvelope,
} from '@contextlens/shared';
import type { Config } from './config.js';
import { createLogger, type Logger } from './logger.js';

type Variables = {
  requestId: string;
  logger: Logger;
};

export function createApp(config: Config, version: string): Hono<{ Variables: Variables }> {
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

  app.notFound((c) => {
    const requestId = c.get('requestId');
    const error = new ApiError(ERROR_CODES.NOT_FOUND, 'Route not found');
    return c.json(toErrorEnvelope(error, requestId), error.status as ContentfulStatusCode);
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId');
    const logger = c.get('logger') ?? baseLogger;
    const apiError =
      err instanceof ApiError ? err : new ApiError(ERROR_CODES.INTERNAL, 'Internal server error');
    logger.error(apiError.message, { requestId, code: apiError.code });
    return c.json(toErrorEnvelope(apiError, requestId), apiError.status as ContentfulStatusCode);
  });

  return app;
}
