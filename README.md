# ContextLens

A Chrome Manifest V3 extension that captures browser activity (tab changes, navigation, DOM
interactions, screenshots) and persists it through a backend API into Postgres, with consent
treated as a first class feature rather than a checkbox.

## Why this is not trivial

The Manifest V3 service worker is terminated after a short idle period and restarted on the next
event. That single fact drives most of the design: nothing durable is held in memory, every event
is written to IndexedDB before it counts as captured, timers are `chrome.alarms` rather than
`setInterval`, and event IDs are client generated ULIDs so that a retry after termination is
provably idempotent rather than a duplicate row.

## Quick start

```bash
npm install
cp .env.example .env
npm run db:up        # Postgres in Docker on port 54329
npm run db:migrate
npm run db:seed
npm run dev          # API on :8787, extension build in watch mode
```

Load the extension: open `chrome://extensions`, enable Developer mode, choose "Load unpacked",
and select `apps/extension/dist`.

## Layout

| Path | Contains |
|------|----------|
| `apps/api` | HTTP API. Batch event ingest, health, export and delete. |
| `apps/extension` | The MV3 extension: service worker, content script, popup, options page. |
| `packages/shared` | Contracts shared by both sides: event schema, error envelope, route constants. |
| `packages/db` | SQL migrations and the seed script. |
| `tests/e2e` | Playwright suite that loads the built extension into real Chrome. |
| `docs/adr` | One record per architectural decision that is expensive to reverse. |

## Testing

```bash
npm run typecheck
npm run lint
npm run test:e2e     # headless, loads the unpacked extension
```

The end to end suite drives a real Chrome build with the extension loaded, then asserts extension
internals directly through the service worker. Two checks matter more than the rest: that the queue
survives forced service worker termination without dropping or duplicating events, and that
captured screenshot pixels match a known fixture colour.

## Privacy posture

Capture is off by default. A fresh install collects nothing and makes no network calls until
consent is granted, and consent is granted scope by scope (navigation, interaction, dwell,
screenshots). Screenshots stay off even after consent and need a second explicit opt in.

Input values, password fields, clipboard contents, cookies, localStorage, request and response
bodies and raw text are never captured, enforced by not writing the code that would read them
rather than by filtering afterwards. A recording indicator is visible in the page and on the
toolbar whenever capture is active. Export and delete are one click each.

## What v1 deliberately does not do

- LLM or vision enrichment of captured screenshots
- Session replay in the style of rrweb, on both privacy and storage grounds
- Multi user or team dashboards
- Browsers other than Chrome
- Real time streaming, since batching is sufficient
- An admin panel, since a SQL console covers it

## License

MIT
