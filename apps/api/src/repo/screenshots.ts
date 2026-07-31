import type { Pool } from 'pg';

export interface InsertScreenshotParams {
  screenshotId: string;
  userId: string;
  storagePath: string;
  width: number;
  height: number;
  dpr: number;
  bytes: number;
  sha256: Buffer;
}

export async function insertScreenshot(pool: Pool, params: InsertScreenshotParams): Promise<void> {
  await pool.query(
    `insert into screenshots (screenshot_id, event_id, user_id, storage_path, width, height, dpr, bytes, sha256)
     values ($1, null, $2, $3, $4, $5, $6, $7, $8)
     on conflict (screenshot_id) do nothing`,
    [
      params.screenshotId,
      params.userId,
      params.storagePath,
      params.width,
      params.height,
      params.dpr,
      params.bytes,
      params.sha256,
    ],
  );
}
