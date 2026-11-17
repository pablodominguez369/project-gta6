-- Editorial calendar rules per channel (Phase 2, T11). They propose slots; nothing is published.

create table public.schedule_rules (
  id             uuid primary key default gen_random_uuid(),
  channel_id     uuid not null unique references public.channels (id) on delete cascade,
  timezone       text not null default 'Europe/Madrid',
  -- [{ "weekday": 1-7 (ISO), "start": "HH:MM", "end": "HH:MM" }] in the rule's local time.
  windows_json   jsonb not null default '[]'::jsonb check (jsonb_typeof(windows_json) = 'array'),
  cadence_policy jsonb not null default '{}'::jsonb check (jsonb_typeof(cadence_policy) = 'object'),
  approval_mode  text not null default 'approval' check (approval_mode in ('approval', 'manual')),
  enabled        boolean not null default false,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.schedule_rules.approval_mode is
  'Phase 2 offers only approval or manual; autopublish does not exist yet.';

alter table public.schedule_rules enable row level security;
revoke all on table public.schedule_rules from anon;

create trigger schedule_rules_validate_timezone
  before insert or update of timezone on public.schedule_rules
  for each row execute function public.validate_channel_timezone();

create trigger schedule_rules_set_updated_at
  before update on public.schedule_rules
  for each row execute function public.set_updated_at();

create policy "schedule_rules: members read"
  on public.schedule_rules for select to authenticated
  using ((select public.is_member()));

create policy "schedule_rules: admins insert"
  on public.schedule_rules for insert to authenticated
  with check ((select public.has_role('admin')));

create policy "schedule_rules: admins update"
  on public.schedule_rules for update to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

create policy "schedule_rules: admins delete"
  on public.schedule_rules for delete to authenticated
  using ((select public.has_role('admin')));

create trigger schedule_rules_audit
  after insert or update or delete on public.schedule_rules
  for each row execute function public.audit_row_change();
