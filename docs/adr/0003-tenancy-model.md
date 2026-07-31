# ADR-0003: Shared tables with a user_id column, enforced by Row Level Security

Context: the system stores per user private browsing data, so isolation is a correctness and a
trust requirement, not a nicety.
Decision: one set of tables, every row carrying `user_id`, with an RLS policy of
`using (user_id = auth.uid())` on each table.
Alternatives considered: schema per tenant, rejected because it multiplies migration cost by the
user count and makes the export and delete queries harder rather than easier. Database per tenant,
rejected as unjustifiable at v1 scale.
Consequences: every table needs the policy applied, and forgetting it on a new table is a silent
data leak. Mitigated by asserting policy presence in the migration test rather than by review.
Revisit when: a customer requires physical data separation for compliance reasons.
