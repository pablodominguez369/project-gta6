-- Opportunities (candidate topics) and claims with their evidence (Phase 2, T11).

create type public.opportunity_status as enum ('new', 'shortlisted', 'accepted', 'discarded', 'expired');
create type public.claim_certainty as enum ('confirmed', 'reported', 'rumor', 'speculation', 'opinion');

create table public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  topic           text not null check (char_length(topic) between 1 and 200),
  summary         text not null default '' check (char_length(summary) <= 2000),
  status          public.opportunity_status not null default 'new',
  score           numeric(5, 2) not null default 0 check (score between 0 and 100),
  certainty       public.claim_certainty not null default 'rumor',
  risk_flags      text[] not null default '{}',
  expires_at      timestamptz,
  decision_reason text check (char_length(decision_reason) <= 1000),
  decided_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint opportunities_decision_has_reason
    check (status not in ('accepted', 'discarded') or decision_reason is not null)
);

create index opportunities_status_idx on public.opportunities (status, score desc);

alter table public.opportunities enable row level security;
revoke all on table public.opportunities from anon;

create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

create policy "opportunities: members read"
  on public.opportunities for select to authenticated
  using ((select public.is_member()));

create policy "opportunities: editors create"
  on public.opportunities for insert to authenticated
  with check ((select public.has_any_role(array['admin', 'editor']::public.app_role[])));

create policy "opportunities: editors decide"
  on public.opportunities for update to authenticated
  using ((select public.has_any_role(array['admin', 'editor']::public.app_role[])))
  with check ((select public.has_any_role(array['admin', 'editor']::public.app_role[])));

create table public.opportunity_sources (
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  source_id      uuid not null references public.sources (id) on delete restrict,
  created_at     timestamptz not null default now(),
  primary key (opportunity_id, source_id)
);

create index opportunity_sources_source_idx on public.opportunity_sources (source_id);

alter table public.opportunity_sources enable row level security;
revoke all on table public.opportunity_sources from anon;

create policy "opportunity_sources: members read"
  on public.opportunity_sources for select to authenticated
  using ((select public.is_member()));

create policy "opportunity_sources: editors link"
  on public.opportunity_sources for insert to authenticated
  with check ((select public.has_any_role(array['admin', 'editor']::public.app_role[])));

create policy "opportunity_sources: editors unlink"
  on public.opportunity_sources for delete to authenticated
  using ((select public.has_any_role(array['admin', 'editor']::public.app_role[])));

create table public.claims (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  text           text not null check (char_length(text) between 1 and 1000),
  certainty      public.claim_certainty not null,
  -- Sensitive claims need two independent reliable sources or one official primary source
  -- (checked by the domain policy before a script may state them).
  sensitive      boolean not null default false,
  verified_at    timestamptz,
  verified_by    uuid references auth.users (id) on delete set null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint claims_verification_complete
    check ((verified_at is null) = (verified_by is null)),
  constraint claims_not_verified_by_author
    check (verified_by is null or verified_by is distinct from created_by)
);

create index claims_opportunity_idx on public.claims (opportunity_id);

alter table public.claims enable row level security;
revoke all on table public.claims from anon;

create trigger claims_keep_created_by
  before update on public.claims
  for each row execute function public.keep_created_by();

create trigger claims_set_updated_at
  before update on public.claims
  for each row execute function public.set_updated_at();

create policy "claims: members read"
  on public.claims for select to authenticated
  using ((select public.is_member()));

create policy "claims: editors create"
  on public.claims for insert to authenticated
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and created_by = (select auth.uid())
    and verified_at is null
  );

create policy "claims: editors update"
  on public.claims for update to authenticated
  using ((select public.has_any_role(array['admin', 'editor']::public.app_role[])))
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and (verified_by is null or verified_by = (select auth.uid()))
  );

create table public.claim_sources (
  claim_id   uuid not null references public.claims (id) on delete cascade,
  source_id  uuid not null references public.sources (id) on delete restrict,
  quote_hint text check (char_length(quote_hint) <= 300),
  created_at timestamptz not null default now(),
  primary key (claim_id, source_id)
);

create index claim_sources_source_idx on public.claim_sources (source_id);

alter table public.claim_sources enable row level security;
revoke all on table public.claim_sources from anon;

create policy "claim_sources: members read"
  on public.claim_sources for select to authenticated
  using ((select public.is_member()));

create policy "claim_sources: editors link"
  on public.claim_sources for insert to authenticated
  with check ((select public.has_any_role(array['admin', 'editor']::public.app_role[])));

create policy "claim_sources: editors unlink"
  on public.claim_sources for delete to authenticated
  using ((select public.has_any_role(array['admin', 'editor']::public.app_role[])));

-- A claim presented as fact (confirmed or reported) must cite at least one source. Checked at
-- commit time, so a claim and its sources can be written in the same transaction.
create function public.check_claim_has_source()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target uuid;
begin
  if tg_table_name = 'claims' then
    target := new.id;
  else
    target := old.claim_id;
  end if;
  if exists (
    select 1 from public.claims c
     where c.id = target
       and c.certainty in ('confirmed', 'reported')
       and not exists (select 1 from public.claim_sources s where s.claim_id = c.id)
  ) then
    raise exception 'a confirmed or reported claim needs at least one source'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger claims_require_source
  after insert or update of certainty on public.claims
  deferrable initially deferred
  for each row execute function public.check_claim_has_source();

create constraint trigger claim_sources_keep_source
  after delete on public.claim_sources
  deferrable initially deferred
  for each row execute function public.check_claim_has_source();

create trigger opportunities_audit
  after insert or update or delete on public.opportunities
  for each row execute function public.audit_row_change();

create trigger claims_audit
  after insert or update or delete on public.claims
  for each row execute function public.audit_row_change();
