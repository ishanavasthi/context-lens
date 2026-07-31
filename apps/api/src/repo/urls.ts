import type { Pool, PoolClient } from 'pg';
import type { UrlParts } from '../url.js';

/**
 * Inserts or returns the dimension row for a URL.
 *
 * The components are written, not only the hash. A row holding just a hash dedupes
 * correctly and answers no question at all: every "which sites did I use" query comes
 * back empty while appearing to work, because the join succeeds and simply yields nulls.
 *
 * On conflict the components are refreshed rather than ignored, which also backfills rows
 * written before they were stored.
 */
export async function upsertUrl(
  client: Pool | PoolClient,
  urlHash: Buffer,
  parts: Pick<UrlParts, 'scheme' | 'host' | 'path'>,
): Promise<number> {
  const result = await client.query(
    `insert into urls (url_hash, scheme, host, path)
     values ($1, $2, $3, $4)
     on conflict (url_hash) do update
       set scheme = coalesce(excluded.scheme, urls.scheme),
           host   = coalesce(excluded.host, urls.host),
           path   = coalesce(excluded.path, urls.path)
     returning url_id`,
    [urlHash, parts.scheme, parts.host, parts.path],
  );
  return result.rows[0].url_id;
}
