import type { Pool } from 'pg';

export interface DeviceAuth {
  deviceId: string;
  userId: string;
}

export async function findActiveDeviceByTokenHash(
  pool: Pool,
  tokenHash: Buffer,
): Promise<DeviceAuth | null> {
  const result = await pool.query(
    'select device_id, user_id from devices where token_hash = $1 and revoked_at is null',
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { deviceId: row.device_id, userId: row.user_id };
}
