# ADR-0005: Batch ingest endpoint with cursor pagination and a single error envelope

Context: the extension sends many small events and must survive retries, and read endpoints will
be paged while new rows are arriving continuously.
Decision: `POST /v1/events:batch` accepting up to 500 events, idempotent on event_id, returning
accepted and duplicate counts. Reads use cursor pagination on `(ts, event_id)`. Every non 2xx
response is the single error envelope defined in `packages/shared`.
Alternatives considered: one request per event, rejected on request volume and battery cost.
Offset pagination, rejected because rows shift under the cursor during concurrent ingest, which
silently skips or repeats records.
Consequences: clients must handle partial batch acceptance, and the duplicate count becomes the
signal for detecting retry storms.
Revisit when: a latency requirement appears that batching cannot meet.
