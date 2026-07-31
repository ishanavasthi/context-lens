-- Row level security keyed on current_setting('app.current_user_id', true).
-- This works on plain Postgres now, and maps onto Supabase auth.uid() later
-- (a Supabase migration can simply swap the setting for auth.uid()).

alter table devices enable row level security;
alter table sessions enable row level security;
alter table events enable row level security;
alter table screenshots enable row level security;

create policy devices_user_isolation on devices
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy sessions_user_isolation on sessions
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy events_user_isolation on events
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy screenshots_user_isolation on screenshots
  using (user_id = current_setting('app.current_user_id', true)::uuid);
