import { createHash } from 'node:crypto';
import pg from 'pg';
import { connectionConfig, describeTarget, loadRootEnv } from '../connection.js';

const { Client } = pg;

loadRootEnv();

function urlHash(url) {
  return createHash('sha256').update(url).digest();
}

const LONG_REFERRER =
  'https://example.com/search?q=' + 'a'.repeat(2000) + '&ref=seed-fixture-long-value';

const USERS = [
  { user_id: '00000000-0000-0000-0000-000000000001', email: 'alice@example.com' },
  { user_id: '00000000-0000-0000-0000-000000000002', email: 'bob@example.com' },
];

const DEVICES = [
  {
    device_id: '00000000-0000-4000-8000-000000000001',
    user_id: USERS[0].user_id,
    user_agent: 'Mozilla/5.0 (Macintosh) Chrome/128.0',
    platform: 'macOS',
    token_hash: createHash('sha256').update('dev-device-token-0000000000000000').digest(),
  },
  {
    device_id: '00000000-0000-0000-0000-0000000000a2',
    user_id: USERS[1].user_id,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0',
    platform: 'Windows',
  },
];

const SESSIONS = [
  {
    session_id: 'seed-session-0000000000000001',
    device_id: DEVICES[0].device_id,
    user_id: USERS[0].user_id,
    started_at: '2026-07-01T09:00:00Z',
    consent_scopes: ['navigation', 'interaction', 'dwell', 'screenshots'],
  },
  {
    session_id: 'seed-session-0000000000000002',
    device_id: DEVICES[1].device_id,
    user_id: USERS[1].user_id,
    started_at: '2026-07-01T10:00:00Z',
    consent_scopes: ['navigation', 'interaction'],
  },
];

const URLS = [
  { url: 'https://example.com/docs', scheme: 'https', host: 'example.com', path: '/docs', title: 'Docs' },
  {
    url: 'https://example.co.jp/tokushu',
    scheme: 'https',
    host: 'example.co.jp',
    path: '/tokushu',
    title: '日本語のタイトル 🎌 with émojis and ünïcödé',
  },
];

function buildEventsForSession(session, urlIds) {
  const base = {
    session_id: session.session_id,
    user_id: session.user_id,
  };
  const t0 = new Date(session.started_at).getTime();
  const ts = (offsetSeconds) => new Date(t0 + offsetSeconds * 1000).toISOString();

  return [
    {
      ...base,
      event_id: `${session.session_id}-evt-01`,
      type: 'session_start',
      ts: ts(0),
      seq: 0,
      tab_id: 1,
      url_id: null,
      payload: { consent_scopes: session.consent_scopes },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-02`,
      type: 'navigation',
      ts: ts(5),
      seq: 1,
      tab_id: null,
      url_id: urlIds[1],
      payload: {
        referrer_url: LONG_REFERRER,
        transition_type: 'link',
        title: URLS[1].title,
        is_spa: false,
      },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-03`,
      type: 'tab_activated',
      ts: ts(10),
      seq: 2,
      tab_id: 1,
      url_id: urlIds[0],
      payload: { from_tab_id: 2, window_id: 1 },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-04`,
      type: 'click',
      ts: ts(15),
      seq: 3,
      tab_id: 1,
      url_id: urlIds[0],
      payload: {
        selector_path: 'body > main > button.cta',
        tag: 'BUTTON',
        role: 'button',
        x_pct: 42.5,
        y_pct: 61.2,
        is_trusted: true,
      },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-05`,
      type: 'scroll',
      ts: ts(20),
      seq: 4,
      tab_id: 1,
      url_id: urlIds[0],
      payload: { max_scroll_pct: 75.0, viewport_h: 900, doc_h: 3600 },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-06`,
      type: 'input_focus',
      ts: ts(25),
      seq: 5,
      tab_id: 1,
      url_id: urlIds[0],
      payload: { field_type: 'text', is_sensitive: false },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-07`,
      type: 'idle_state_change',
      ts: ts(30),
      seq: 6,
      tab_id: 1,
      url_id: null,
      payload: { state: 'idle' },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-08`,
      type: 'consent_change',
      ts: ts(35),
      seq: 7,
      tab_id: 1,
      url_id: null,
      payload: { from: ['navigation'], to: session.consent_scopes, source: 'settings_page' },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-09`,
      type: 'screenshot',
      ts: ts(40),
      seq: 8,
      tab_id: 1,
      url_id: urlIds[0],
      payload: {
        storage_path: `screenshots/${session.session_id}/evt-09.webp`,
        w: 1440,
        h: 900,
        dpr: 2,
        bytes: 245678,
        sha256: urlHash(`${session.session_id}-evt-09`).toString('hex'),
        trigger: 'periodic',
      },
    },
    {
      ...base,
      event_id: `${session.session_id}-evt-10`,
      type: 'page_view_end',
      ts: ts(45),
      seq: 9,
      tab_id: 1,
      url_id: urlIds[0],
      payload: { dwell_ms: 45000, engaged_ms: 30000, max_scroll_pct: 80 },
    },
  ];
}

async function main() {
  console.log(`seeding ${describeTarget()}`);
  const client = new Client(connectionConfig());
  await client.connect();

  try {
    await client.query('begin');

    for (const user of USERS) {
      await client.query(
        'insert into users (user_id, email) values ($1, $2) on conflict (user_id) do nothing',
        [user.user_id, user.email],
      );
    }

    for (const device of DEVICES) {
      await client.query(
        `insert into devices (device_id, user_id, user_agent, platform, token_hash)
         values ($1, $2, $3, $4, $5)
         on conflict (device_id) do update set token_hash = excluded.token_hash`,
        [device.device_id, device.user_id, device.user_agent, device.platform, device.token_hash ?? null],
      );
    }

    for (const session of SESSIONS) {
      await client.query(
        `insert into sessions (session_id, device_id, user_id, started_at, consent_scopes)
         values ($1, $2, $3, $4, $5) on conflict (session_id) do nothing`,
        [session.session_id, session.device_id, session.user_id, session.started_at, session.consent_scopes],
      );
    }

    const urlIds = [];
    for (const url of URLS) {
      const hash = urlHash(url.url);
      const result = await client.query(
        `insert into urls (url_hash, scheme, host, path, title)
         values ($1, $2, $3, $4, $5)
         on conflict (url_hash) do update set url_hash = excluded.url_hash
         returning url_id`,
        [hash, url.scheme, url.host, url.path, url.title],
      );
      urlIds.push(result.rows[0].url_id);
    }

    for (const session of SESSIONS) {
      const events = buildEventsForSession(session, urlIds);
      for (const event of events) {
        await client.query(
          `insert into events (event_id, session_id, user_id, type, ts, seq, tab_id, url_id, payload)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (event_id) do nothing`,
          [
            event.event_id,
            event.session_id,
            event.user_id,
            event.type,
            event.ts,
            event.seq,
            event.tab_id,
            event.url_id,
            event.payload,
          ],
        );
      }
    }

    await client.query('commit');
    console.log('seed complete');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
