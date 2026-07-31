import type { Pool, PoolClient } from 'pg';

export async function upsertUrl(client: Pool | PoolClient, urlHash: Buffer): Promise<number> {
  const result = await client.query(
    `insert into urls (url_hash)
     values ($1)
     on conflict (url_hash) do update set url_hash = excluded.url_hash
     returning url_id`,
    [urlHash],
  );
  return result.rows[0].url_id;
}
