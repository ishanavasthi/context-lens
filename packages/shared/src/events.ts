import { z } from 'zod';

/**
 * Event contract. Every captured event shares the envelope; type specific fields live
 * in `payload` and are validated by the matching schema below.
 *
 * `event_id` is generated on the client as a ULID and used as the idempotency key.
 * The service worker can be terminated mid flush, so a retry must be provably the same
 * event rather than a second one.
 *
 * `seq` is monotonic per session. Gaps in it are how dropped events are detected, so it
 * is never reused and never reset within a session.
 */

export const EVENT_TYPES = [
  'session_start',
  'session_end',
  'tab_activated',
  'navigation',
  'page_view_end',
  'click',
  'scroll',
  'input_focus',
  'screenshot',
  'idle_state_change',
  'consent_change',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const CONSENT_SCOPES = ['navigation', 'interaction', 'dwell', 'screenshots'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const SCHEMA_VERSION = 1;

export const eventEnvelopeSchema = z.object({
  event_id: z.string().min(20).max(40),
  session_id: z.string().min(20).max(40),
  device_id: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  ts: z.number().int().positive(),
  tz_offset: z.number().int().min(-900).max(900),
  seq: z.number().int().nonnegative(),
  tab_id: z.number().int().optional(),
  url: z.string().url().optional(),
  schema_v: z.literal(SCHEMA_VERSION),
  payload: z.record(z.unknown()).default({}),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const eventPayloadSchemas = {
  session_start: z.object({ consent_scopes: z.array(z.enum(CONSENT_SCOPES)) }),
  session_end: z.object({ reason: z.string().optional() }),
  tab_activated: z.object({
    from_tab_id: z.number().int().optional(),
    window_id: z.number().int().optional(),
  }),
  navigation: z.object({
    referrer_url: z.string().optional(),
    transition_type: z.string().optional(),
    title: z.string().optional(),
    is_spa: z.boolean().default(false),
  }),
  page_view_end: z.object({
    dwell_ms: z.number().int().nonnegative(),
    engaged_ms: z.number().int().nonnegative(),
    max_scroll_pct: z.number().min(0).max(100),
  }),
  click: z.object({
    selector_path: z.string(),
    tag: z.string(),
    role: z.string().optional(),
    aria_label: z.string().optional(),
    text_hash: z.string().optional(),
    x_pct: z.number().min(0).max(100),
    y_pct: z.number().min(0).max(100),
    is_trusted: z.boolean(),
  }),
  scroll: z.object({
    max_scroll_pct: z.number().min(0).max(100),
    viewport_h: z.number().int().positive(),
    doc_h: z.number().int().positive(),
  }),
  input_focus: z.object({
    field_type: z.string(),
    field_name_hash: z.string().optional(),
    is_sensitive: z.boolean(),
  }),
  screenshot: z.object({
    storage_path: z.string(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    dpr: z.number().positive(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string(),
    trigger: z.string(),
  }),
  idle_state_change: z.object({ state: z.enum(['active', 'idle', 'locked']) }),
  consent_change: z.object({
    from: z.array(z.enum(CONSENT_SCOPES)),
    to: z.array(z.enum(CONSENT_SCOPES)),
    source: z.string(),
  }),
} satisfies Record<EventType, z.ZodTypeAny>;

/** Validates the envelope, then the payload against the schema for its type. */
export function parseEvent(input: unknown): EventEnvelope {
  const envelope = eventEnvelopeSchema.parse(input);
  eventPayloadSchemas[envelope.type].parse(envelope.payload);
  return envelope;
}

export const MAX_EVENTS_PER_BATCH = 500;

export const eventBatchSchema = z.object({
  device_id: z.string().uuid(),
  session_id: z.string().min(20).max(40),
  events: z.array(eventEnvelopeSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

export type EventBatch = z.infer<typeof eventBatchSchema>;

export const eventBatchResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
});

export type EventBatchResult = z.infer<typeof eventBatchResultSchema>;

/**
 * What a content script hands to the service worker. The content script knows the
 * event id, the type and the payload; only the worker knows the session, the device
 * and the sequence number, so it completes the envelope. Keeping seq assignment in
 * one place is what makes gap detection meaningful.
 */
export const pendingEventSchema = z.object({
  event_id: z.string().min(20).max(40),
  type: z.enum(EVENT_TYPES),
  ts: z.number().int().positive(),
  tz_offset: z.number().int().min(-900).max(900),
  url: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
});

export type PendingEvent = z.infer<typeof pendingEventSchema>;

/** The single runtime message name carrying captured events to the worker. */
export const CONTENT_EVENTS_MESSAGE = 'contextlens:events';
