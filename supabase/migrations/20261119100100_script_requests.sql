-- Requests to draft a script with the LLM (Phase 2, T17). Outbox pattern: editors insert a row,
-- the worker picks it up, calls the LLM through the spend gate and writes the draft script.

create type public.script_request_status as enum (
  'queued', 'running', 'succeeded', 'blocked', 'failed'
);

create table public.script_requests (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid not null references public.opportunities (id) on delete cascade,
  locale            text not null default 'es-ES' check (locale in ('es-ES', 'es-419')),
  target_duration_s integer not null default 45 check (target_duration_s between 20 and 60),
  status            public.script_request_status not null default 'queued',
  error_code        text,
  next_attempt_at   timestamptz,
  script_id         uuid references public.scripts (id) on delete set null,
  requested_by      uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.script_requests is
  'LLM drafting requests. Clients only insert queued rows; the worker owns every state change.';

-- At most one open request per opportunity, so a double click never pays twice.
create unique index script_requests_one_open_idx
  on public.script_requests (opportunity_id)
  where status in ('queued', 'running', 'blocked');

create index script_requests_dispatch_idx
  on public.script_requests (status, next_attempt_at)
  where status in ('queued', 'blocked', 'running');

alter table public.script_requests enable row level security;
revoke all on table public.script_requests from anon;

create trigger script_requests_set_updated_at
  before update on public.script_requests
  for each row execute function public.set_updated_at();

create trigger script_requests_audit
  after insert or update or delete on public.script_requests
  for each row execute function public.audit_row_change();

create policy "script_requests: members read"
  on public.script_requests for select to authenticated
  using ((select public.is_member()));

create policy "script_requests: editors request"
  on public.script_requests for insert to authenticated
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and requested_by = (select auth.uid())
    and status = 'queued'
    and error_code is null
    and next_attempt_at is null
    and script_id is null
    and exists (
      select 1 from public.opportunities o
       where o.id = opportunity_id and o.status = 'accepted'
    )
  );
-- No update or delete policies: only the worker changes requests.
