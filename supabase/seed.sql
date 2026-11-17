-- Local development seed. Fictional data only; never real accounts or credentials.
-- Users are not seeded: create them with the runbook docs/runbooks/first-admin.md.

insert into public.channels (id, platform, display_name, mode, timezone)
values
  ('00000000-0000-4000-8000-000000000001', 'simulated', 'Canal simulado (local)', 'draft', 'Europe/Madrid');
