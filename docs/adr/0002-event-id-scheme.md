# ADR-0002: Client generated ULIDs as event identifiers

Context: the MV3 service worker can be killed mid flush, so the same batch may be sent twice.
Decision: the extension generates a ULID for every event at capture time, and that ULID is the
primary key. Ingest is `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
Alternatives considered: server generated bigserial, rejected because a retry after service worker
death becomes indistinguishable from a genuine second event, which is silent data corruption.
UUIDv4, rejected because it carries no time ordering, so the timeline index would need a separate
sort key and would fragment on insert.
Consequences: the client is trusted to generate unique IDs, so a buggy client can suppress its own
events by reusing an ID. Accepted, since the alternative failure (duplicated rows) is worse and
harder to detect.
Revisit when: never, without a data migration. This is the hardest door in the system to reverse.
