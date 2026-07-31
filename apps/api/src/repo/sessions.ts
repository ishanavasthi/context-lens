import type { Pool } from 'pg';

/**
 * Ensures the session row exists before events referencing it are inserted.
 *
 * The extension mints a session id when the service worker starts, and that
 * worker can be terminated at any moment. If session creation depended on a
 * session_start event arriving first, losing that one event would make every
 * later event in the session fail its foreign key forever. Ingest therefore
 * creates the session on demand and is safe to call on every batch.
 */
export async function ensureSession(
  pool: Pool,
  params: { sessionId: string; deviceId: string; userId: string; consentScopes?: string[] },
): Promise<void> {
  await pool.query(
    `insert into sessions (session_id, device_id, user_id, started_at, consent_scopes)
     values ($1, $2, $3, now(), $4)
     on conflict (session_id) do nothing`,
    [params.sessionId, params.deviceId, params.userId, params.consentScopes ?? []],
  );
}
