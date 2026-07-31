# ADR-0004: Supabase Auth user JWT plus a per device token row

Context: the client is a browser extension, so anything shipped inside it is public by definition.
Decision: the user signs in once on the options page through Supabase Auth. The extension holds a
per device token row, and the service worker refreshes the JWT. Every request carries it and RLS
enforces scope independently.
Alternatives considered: shipping the anon key alone, rejected because it is public and would make
row isolation depend entirely on handler correctness. A single long lived token per user, rejected
because one compromised install could not be revoked without signing every other device out.
Consequences: token refresh has to work inside an ephemeral service worker, which is extra
complexity in exactly the least reliable runtime in the system.
Revisit when: a second client type (mobile, CLI) needs the same auth path.
