# Decisions

Append only. Entries are never edited or deleted, only superseded by later entries.

## 2026-07-31: Playwright as a test library, no MCP driving and no Computer Use

Why: a throwaway MV3 spike showed the service worker can decode its own `captureVisibleTab` PNG
and return exact pixel values, and that Playwright clicks arrive at the content script as
`isTrusted: true`. Both proposed OS level verification jobs were therefore already covered.
Rejected: Playwright MCP as primary driver (works, but an accessibility tree per check costs
thousands of tokens against a Bash call returning pass or fail, and it cannot run in CI);
Computer Use (its one unique capability, confirming the toolbar badge renders, amounts to testing
Chrome rather than our code, and browsers are granted at read tier where clicks are blocked).
Revisit when: a requirement appears that genuinely needs browser chrome pixels asserted in CI.
Tier: Verified.

## 2026-07-31: LLM and vision enrichment cut from v1

Why: the difficulty in this project is the MV3 runtime and the consent model, not an inference
call. The architecture playbook caps novelty at one component and this keeps it at zero.
Rejected: a thin caption per screenshot (defensible, but adds a milestone before the core loop is
proven); enrichment as the centrepiece (shifts project risk from the extension to the pipeline).
Revisit when: the timeline UI milestone passes with time to spare.
Tier: Verified.

## 2026-07-31: Postgres via Supabase as the database

Why: `INSERT ... ON CONFLICT (event_id) DO NOTHING` makes idempotent ingest a single statement,
which is exactly the primitive an ephemeral service worker forces on us. Row Level Security also
enforces per user isolation at the database layer rather than in handler code.
Rejected: Mongo (payload types are known and finite, so looseness buys nothing while SQL
aggregates buy a lot); plain Neon or RDS (workable, but storage, auth and RLS each become a
separate build).
Revisit when: Supabase free tier limits bite, or screenshot storage cost dominates.
Tier: Likely, since the free tier limits have not been measured against real screenshot volume.

## 2026-07-31: Client generated ULIDs as event IDs

Why: the service worker can die mid flush. With server generated IDs a retry is indistinguishable
from a genuine second event. ULIDs also sort by time, making `(session_id, event_id)` a natural
timeline index.
Rejected: server generated bigserial (breaks idempotency); UUIDv4 (no time ordering, so the
timeline index needs a separate sort key).
Revisit when: never, without a data migration.
Tier: Verified.

## 2026-07-31: npm workspaces rather than pnpm

Why: neither pnpm nor corepack is present on the build machine, so the standard pnpm bootstrap
path is broken here. npm ships with Node, which removes an install step for anyone cloning this
repo. The workspace is small enough that pnpm's advantages do not apply.
Rejected: pnpm (better for large monorepos, but needs a global install first); Yarn (same problem,
no advantage over npm at this size).
Revisit when: the workspace exceeds roughly ten packages or install time becomes a complaint.
Tier: Verified.

## 2026-07-31: Ingest creates the session row on demand

Why: the extension mints a session id when the service worker starts, and that worker can be
terminated at any moment. If the sessions row were created only by a session_start event, losing
that single event would make every later event in the session fail its foreign key forever, which
converts one dropped message into a silently dead session. Ingest therefore upserts the session on
every batch, taking the device id from the authenticated device rather than the request body so a
client cannot attribute events to another device.
Rejected: requiring session_start to arrive first (fragile in exactly the runtime this project is
built around); dropping the foreign key (loses the guarantee that every event belongs to a real
session).
Revisit when: sessions grow attributes that genuinely cannot be defaulted at first sight.
Tier: Verified, by the walking skeleton test which failed on the foreign key before this change and
passes after it.

## 2026-07-31: Extension entry files are named for their role, not index.ts

Why: both entry points were originally src/background/index.ts and src/content/index.ts. CRXJS
names emitted assets after the entry basename, so both produced index.ts-<hash>.js, and the
generated service worker loader imported the content script bundle instead of the background one.
The extension loaded and every unit test passed while the service worker was running the wrong
code. Renaming to service-worker.ts and content-script.ts makes the emitted names unambiguous.
Rejected: pinning output file names in the Vite config (works, but leaves the trap in place for the
next entry point someone adds).
Revisit when: never. Distinct entry names cost nothing.
Tier: Verified, by inspecting the emitted loader before and after the rename.

## 2026-07-31: Accept five dev only audit advisories rather than break eslint

Why: `npm audit` reports five high severity findings, all the same root cause, a denial of service
in `brace-expansion` reached transitively through eslint's legacy `minimatch@3`. The advisory range
covers every version below 5.0.8, so the only override that clears it forces v5 onto `minimatch@3`,
which expects the v1 API. Tested: the override does clear the audit to zero, and it breaks eslint
with a stack trace inside `@eslint/config-array`. A working linter is worth more than a clean audit
number for a dependency that never ships to a user.
Rejected: `npm audit fix --force` (downgrades or breaks eslint the same way); pinning `minimatch`
directly (`@eslint/eslintrc` pins v3 itself, so the override does not take).
Revisit when: eslint drops its `minimatch@3` dependency upstream, then remove this entry.
Tier: Verified, by running the override and observing eslint fail.

## 2026-07-31: Shared contracts package written before any parallel implementation

Why: four agents implementing against an unstated error shape will produce four different error
shapes, and the mismatch only surfaces at integration. The event schema, error envelope, route
constants and health response are fixed in `packages/shared` first and imported, never restated.
Rejected: letting each package define its own types and reconciling later (this is the specific
failure the orchestration playbook warns about).
Revisit when: a contract change is needed, at which point it changes in one place.
Tier: Verified.
