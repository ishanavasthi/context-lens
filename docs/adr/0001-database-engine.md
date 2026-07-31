# ADR-0001: Postgres via Supabase as the database engine

Context: an ephemeral MV3 service worker retries flushes after termination, so ingest must be
idempotent, and the product's core queries are timeline and aggregate shaped.
Decision: Postgres, hosted on Supabase, with a fixed indexed envelope plus a JSONB payload column.
Alternatives considered: Mongo, rejected because payload types are known and finite so schema
looseness buys nothing while SQL window functions buy the three core queries outright. Plain Neon
or RDS, rejected because object storage for screenshots, auth, and row level isolation would each
become a separate build and a separate credential set.
Consequences: committed to SQL migrations as the only schema change path, and to Row Level
Security as the enforcement point for per user isolation rather than handler code.
Revisit when: screenshot storage cost dominates the bill, or free tier limits block a milestone.
