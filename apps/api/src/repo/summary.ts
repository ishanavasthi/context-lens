import type { Pool } from 'pg';
import type { SummaryResponse } from '@contextlens/shared';

export interface SummaryParams {
  userId: string;
  from?: Date;
  to?: Date;
}

export async function getSummary(pool: Pool, params: SummaryParams): Promise<SummaryResponse> {
  const conditions = ['user_id = $1'];
  const eConditions = ['e.user_id = $1'];
  const values: unknown[] = [params.userId];

  if (params.from) {
    values.push(params.from);
    conditions.push(`ts >= $${values.length}`);
    eConditions.push(`e.ts >= $${values.length}`);
  }
  if (params.to) {
    values.push(params.to);
    conditions.push(`ts <= $${values.length}`);
    eConditions.push(`e.ts <= $${values.length}`);
  }
  const eventsWhere = conditions.join(' and ');
  const eWhere = eConditions.join(' and ');

  const totalsResult = await pool.query(
    `select
       (select count(*) from events where ${eventsWhere}) as events,
       (select count(distinct session_id) from events where ${eventsWhere}) as sessions,
       (select count(*) from screenshots s join events e on e.event_id = s.event_id where ${eWhere}) as screenshots`,
    values,
  );
  const totalsRow = totalsResult.rows[0];

  const byDomainResult = await pool.query(
    `select
       coalesce(u.host, '(unknown)') as host,
       count(*)::bigint as events,
       coalesce(sum((e.payload->>'dwell_ms')::bigint), 0) as dwell_ms
     from events e
     left join urls u on u.url_id = e.url_id
     where ${eWhere} and e.type = 'page_view_end'
     group by coalesce(u.host, '(unknown)')
     order by dwell_ms desc, events desc
     limit 50`,
    values,
  );

  const sessionsResult = await pool.query(
    `select
       e.session_id,
       min(e.ts) as started_at,
       max(e.ts) as last_event_at,
       count(*)::bigint as events
     from events e
     where ${eWhere}
     group by e.session_id
     order by max(e.ts) desc
     limit 50`,
    values,
  );

  return {
    totals: {
      events: Number(totalsRow.events),
      sessions: Number(totalsRow.sessions),
      screenshots: Number(totalsRow.screenshots),
    },
    byDomain: byDomainResult.rows.map((row) => ({
      host: row.host,
      events: Number(row.events),
      dwellMs: Number(row.dwell_ms),
    })),
    sessions: sessionsResult.rows.map((row) => ({
      sessionId: row.session_id,
      startedAt: (row.started_at as Date).toISOString(),
      lastEventAt: (row.last_event_at as Date).toISOString(),
      events: Number(row.events),
    })),
  };
}
