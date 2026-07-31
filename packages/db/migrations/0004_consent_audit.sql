-- Append only audit trail of consent scope changes.

create table consent_audit (
  audit_id bigserial primary key,
  user_id uuid not null,
  device_id uuid,
  from_scopes text[] not null,
  to_scopes text[] not null,
  source text not null,
  at timestamptz not null default now()
);

alter table consent_audit enable row level security;

create policy consent_audit_user_isolation on consent_audit
  using (user_id = current_setting('app.current_user_id', true)::uuid);
