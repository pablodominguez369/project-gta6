-- Idempotent simulated publishing (Phase 1, T10).
--
-- reconcile_required: set to true (and committed) BEFORE the worker calls the platform. From then
-- on every attempt must look up the external state first, so a lost response can never produce a
-- second post (rule 7). It is never reset while the publication is not terminal.
-- next_attempt_at: earliest time the dispatcher may pick a blocked publication again.

alter table public.publications
  add column reconcile_required boolean not null default false,
  add column next_attempt_at timestamptz;

comment on column public.publications.reconcile_required is
  'True once a publish call may have reached the platform. Every later attempt reconciles first.';
comment on column public.publications.next_attempt_at is
  'Blocked publications are not dispatched again before this time.';

create index publications_dispatch_idx on public.publications (status, next_attempt_at);

-- Clients may only enqueue fresh publications.
drop policy "publications: admins and publishers enqueue" on public.publications;

create policy "publications: admins and publishers enqueue"
  on public.publications for insert
  to authenticated
  with check (
    (select public.has_any_role(array['admin', 'publisher']::public.app_role[]))
    and status = 'queued'
    and external_id is null
    and published_at is null
    and reconcile_required = false
    and next_attempt_at is null
  );

-- Remote side of the simulated platform. It deliberately has NO unique constraint on
-- idempotency_key: like a real non-idempotent API it stores duplicates, so tests can prove that
-- the orchestrator never creates one. Only the worker (service role / direct connection) uses it.
create table public.simulated_platform_posts (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  external_id     text not null unique,
  permalink       text,
  status          text not null check (status in ('published', 'processing', 'scheduled', 'rejected')),
  created_at      timestamptz not null default now()
);

comment on table public.simulated_platform_posts is
  'Fake platform storage for the SimulatedPublisher. Never contains real content or accounts.';

create index simulated_platform_posts_key_idx
  on public.simulated_platform_posts (idempotency_key, created_at);

alter table public.simulated_platform_posts enable row level security;
revoke all on table public.simulated_platform_posts from anon, authenticated;
-- No policies: not readable or writable through the API by any signed-in user.
