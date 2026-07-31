import type { Pool } from 'pg';

const BATCH_SIZE = 500;

export interface UserDataCounts {
  sessions: number;
  events: number;
  screenshots: number;
}

export async function countUserData(pool: Pool, userId: string): Promise<UserDataCounts> {
  const result = await pool.query(
    `select
       (select count(*) from sessions where user_id = $1) as sessions,
       (select count(*) from events where user_id = $1) as events,
       (select count(*) from screenshots where user_id = $1) as screenshots`,
    [userId],
  );
  const row = result.rows[0];
  return {
    sessions: Number(row.sessions),
    events: Number(row.events),
    screenshots: Number(row.screenshots),
  };
}

export async function* iterateSessions(
  pool: Pool,
  userId: string,
): AsyncGenerator<Record<string, unknown>> {
  let after: string | null = null;
  for (;;) {
    const result: { rows: Array<Record<string, unknown> & { session_id: string }> } =
      await pool.query(
        `select session_id, device_id, started_at, ended_at, consent_scopes
         from sessions
         where user_id = $1 and ($2::text is null or session_id > $2)
         order by session_id asc
         limit $3`,
        [userId, after, BATCH_SIZE],
      );
    if (result.rows.length === 0) return;
    for (const row of result.rows) yield row;
    after = result.rows[result.rows.length - 1]?.session_id ?? after;
    if (result.rows.length < BATCH_SIZE) return;
  }
}

export async function* iterateEvents(
  pool: Pool,
  userId: string,
): AsyncGenerator<Record<string, unknown>> {
  let after: string | null = null;
  for (;;) {
    const result: { rows: Array<Record<string, unknown> & { event_id: string }> } =
      await pool.query(
        `select event_id, session_id, type, ts, seq, tab_id, payload
         from events
         where user_id = $1 and ($2::text is null or event_id > $2)
         order by event_id asc
         limit $3`,
        [userId, after, BATCH_SIZE],
      );
    if (result.rows.length === 0) return;
    for (const row of result.rows) yield row;
    after = result.rows[result.rows.length - 1]?.event_id ?? after;
    if (result.rows.length < BATCH_SIZE) return;
  }
}

export async function* iterateScreenshots(
  pool: Pool,
  userId: string,
): AsyncGenerator<Record<string, unknown>> {
  let after: string | null = null;
  for (;;) {
    const result: { rows: Array<Record<string, unknown> & { screenshot_id: string }> } =
      await pool.query(
        `select screenshot_id, storage_path, width, height, dpr, bytes
         from screenshots
         where user_id = $1 and ($2::text is null or screenshot_id > $2)
         order by screenshot_id asc
         limit $3`,
        [userId, after, BATCH_SIZE],
      );
    if (result.rows.length === 0) return;
    for (const row of result.rows) yield row;
    after = result.rows[result.rows.length - 1]?.screenshot_id ?? after;
    if (result.rows.length < BATCH_SIZE) return;
  }
}

export interface DeleteAllDataParams {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  screenshotBucket: string;
}

export interface DeleteAllDataResult {
  events: number;
  sessions: number;
  screenshots: number;
  storageObjects: number;
}

export async function deleteAllUserData(
  pool: Pool,
  userId: string,
  params: DeleteAllDataParams,
): Promise<DeleteAllDataResult> {
  const paths = (
    await pool.query('select storage_path from screenshots where user_id = $1', [userId])
  ).rows.map((row: { storage_path: string }) => row.storage_path);

  const eventsResult = await pool.query('delete from events where user_id = $1', [userId]);
  const sessionsResult = await pool.query('delete from sessions where user_id = $1', [userId]);
  const screenshotsResult = await pool.query('delete from screenshots where user_id = $1', [
    userId,
  ]);

  let storageObjects = 0;
  if (paths.length > 0 && params.supabaseUrl && params.supabaseServiceRoleKey) {
    const res = await fetch(`${params.supabaseUrl}/storage/v1/object/${params.screenshotBucket}`, {
      method: 'POST',
      headers: {
        apikey: params.supabaseServiceRoleKey,
        authorization: `Bearer ${params.supabaseServiceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prefixes: paths }),
    });
    if (res.ok) {
      const removed = (await res.json().catch(() => [])) as unknown[];
      storageObjects = Array.isArray(removed) ? removed.length : 0;
    }
  }

  return {
    events: eventsResult.rowCount ?? 0,
    sessions: sessionsResult.rowCount ?? 0,
    screenshots: screenshotsResult.rowCount ?? 0,
    storageObjects,
  };
}

export interface ConsentAuditParams {
  userId: string;
  deviceId?: string | null;
  from: string[];
  to: string[];
  source: string;
}

export async function insertConsentAudit(pool: Pool, params: ConsentAuditParams): Promise<void> {
  await pool.query(
    `insert into consent_audit (user_id, device_id, from_scopes, to_scopes, source)
     values ($1, $2, $3, $4, $5)`,
    [params.userId, params.deviceId ?? null, params.from, params.to, params.source],
  );
}

export async function purgeExpired(pool: Pool, retentionDays: number): Promise<number> {
  const result = await pool.query(
    `delete from events where ts < now() - ($1 || ' days')::interval`,
    [retentionDays],
  );
  return result.rowCount ?? 0;
}
