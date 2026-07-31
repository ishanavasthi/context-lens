import { createHash } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { Pool } from 'pg';
import { ApiError, ERROR_CODES } from '@contextlens/shared';
import { findActiveDeviceByTokenHash } from './repo/devices.js';

export type AuthVariables = {
  userId: string;
  deviceId: string;
};

export function deviceAuth(pool: Pool): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) {
      throw new ApiError(ERROR_CODES.UNAUTHORIZED, 'Missing or malformed Authorization header');
    }

    const tokenHash = createHash('sha256').update(token).digest();
    const device = await findActiveDeviceByTokenHash(pool, tokenHash);
    if (!device) {
      throw new ApiError(ERROR_CODES.UNAUTHORIZED, 'Unknown or revoked device');
    }

    c.set('userId', device.userId);
    c.set('deviceId', device.deviceId);
    await next();
  };
}
