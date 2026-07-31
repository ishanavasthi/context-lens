import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { EventEnvelope } from '@contextlens/shared';
import { normalizeUrl } from '../url.js';
import { upsertUrl } from './urls.js';

export interface InsertEventsBatchResult {
  accepted: number;
  duplicates: number;
}

export async function insertEventsBatch(
  pool: Pool,
  userId: string,
  events: EventEnvelope[],
): Promise<InsertEventsBatchResult> {
  const client = await pool.connect();
  let accepted = 0;
  try {
    await client.query('begin');
    for (const event of events) {
      let urlId: number | null = null;
      if (event.url) {
        const hash = createHash('sha256').update(normalizeUrl(event.url)).digest();
        urlId = await upsertUrl(client, hash);
      }

      const result = await client.query(
        `insert into events (event_id, session_id, user_id, type, ts, seq, tab_id, url_id, payload)
         values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7, $8, $9)
         on conflict (event_id) do nothing`,
        [
          event.event_id,
          event.session_id,
          userId,
          event.type,
          event.ts,
          event.seq,
          event.tab_id ?? null,
          urlId,
          JSON.stringify(event.payload),
        ],
      );
      if (result.rowCount) accepted += 1;
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  return { accepted, duplicates: events.length - accepted };
}

export interface ListEventsParams {
  userId: string;
  type?: string;
  from?: Date;
  to?: Date;
  cursor?: { ts: string; eventId: string };
  limit: number;
}

export interface EventRow {
  event_id: string;
  session_id: string;
  type: string;
  ts: Date;
  seq: number;
  tab_id: number | null;
  url_id: number | null;
  payload: unknown;
  host: string | null;
  path: string | null;
  scheme: string | null;
}

export async function listEvents(pool: Pool, params: ListEventsParams): Promise<EventRow[]> {
  const conditions = ['e.user_id = $1'];
  const values: unknown[] = [params.userId];

  if (params.type) {
    values.push(params.type);
    conditions.push(`e.type = $${values.length}`);
  }
  if (params.from) {
    values.push(params.from);
    conditions.push(`e.ts >= $${values.length}`);
  }
  if (params.to) {
    values.push(params.to);
    conditions.push(`e.ts <= $${values.length}`);
  }
  if (params.cursor) {
    values.push(params.cursor.ts, params.cursor.eventId);
    conditions.push(`(e.ts, e.event_id) < ($${values.length - 1}, $${values.length})`);
  }

  values.push(params.limit);

  const result = await pool.query(
    // Resolve the URL dimension here rather than returning the internal url_id. A client
    // cannot do anything useful with a foreign key, and making every consumer perform its
    // own lookup would push a join into the browser.
    `select e.event_id, e.session_id, e.type, e.ts, e.seq, e.tab_id, e.url_id, e.payload,
            u.host, u.path, u.scheme
     from events e
     left join urls u on u.url_id = e.url_id
     where ${conditions.join(' and ')}
     order by e.ts desc, e.event_id desc
     limit $${values.length}`,
    values,
  );

  return result.rows;
}
