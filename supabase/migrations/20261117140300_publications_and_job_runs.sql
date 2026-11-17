-- Publications (simulated only in Phase 1) and a business view of job executions.
-- Status transitions are written by the worker with the service role; clients can only enqueue.

create type public.publication_status as enum (
  'queued',
  'in_progress',
  'succeeded',
  'failed',
  'ambiguous',
  'blocked'
);

create table public.publications (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references public.channels (id) on delete restrict,
  payload_json    jsonb not null default '{}'::jsonb,
  status          public.publication_status not null default 'queued',
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  external_id     text,
  permalink       text,
  error_code      text,
  scheduled_at    timestamptz,
  published_at    timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint publications_succeeded_has_external_id
    check (status <> 'succeeded' or external_id is not null)
);

comment on column public.publications.idempotency_key is
  'Unique per intended post. A retry reuses the key, so it can never create a second row.';
comment on column public.publications.status is
  'ambiguous = outcome unknown after a timeout; external state must be reconciled before any retry.';

create index publications_channel_id_idx on public.publications (channel_id);
create index publications_status_idx on public.publications (status);

alter table public.publications enable row level security;
revoke all on table public.publications from anon;

create trigger publications_set_updated_at
  before update on public.publications
  for each row execute function public.set_updated_at();

create policy "publications: members read"
  on public.publications for select
  to authenticated
  using ((select public.is_member()));

create policy "publications: admins and publishers enqueue"
  on public.publications for insert
  to authenticated
  with check (
    (select public.has_any_role(array['admin', 'publisher']::public.app_role[]))
    and status = 'queued'
    and external_id is null
    and published_at is null
  );
-- No update/delete policies: only the worker (service role) changes publication state.

create type public.job_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'blocked');

create table public.job_runs (
  id           uuid primary key default gen_random_uuid(),
  job_name     text not null check (char_length(job_name) between 1 and 100),
  queue_job_id text,
  target_type  text,
  target_id    uuid,
  attempt      integer not null default 1 check (attempt >= 1),
  status       public.job_run_status not null default 'queued',
  error_code   text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index job_runs_target_idx on public.job_runs (target_type, target_id);

alter table public.job_runs enable row level security;
revoke all on table public.job_runs from anon;

create policy "job_runs: members read"
  on public.job_runs for select
  to authenticated
  using ((select public.is_member()));
-- No write policies: only the worker (service role) records job runs.
