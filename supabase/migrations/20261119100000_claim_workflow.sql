-- Claims with evidence (Phase 2, T15): create a claim and its sources atomically, and drop a
-- verification as soon as what was verified changes.

-- One transaction for the claim and its sources, so the deferred "claims_require_source" check
-- sees both. security invoker: RLS on claims and claim_sources still applies to the caller.
create function public.create_claim(
  p_opportunity_id uuid,
  p_text text,
  p_certainty public.claim_certainty,
  p_sensitive boolean,
  p_source_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.claims (opportunity_id, text, certainty, sensitive, created_by)
  values (p_opportunity_id, p_text, p_certainty, p_sensitive, (select auth.uid()))
  returning id into new_id;

  insert into public.claim_sources (claim_id, source_id)
  select distinct new_id, source_id
    from unnest(coalesce(p_source_ids, array[]::uuid[])) as source_id;

  return new_id;
end;
$$;

revoke execute on function public.create_claim(uuid, text, public.claim_certainty, boolean, uuid[])
  from public, anon;
grant execute on function public.create_claim(uuid, text, public.claim_certainty, boolean, uuid[])
  to authenticated;

-- A verification covers the text, certainty, sensitivity and sources that were checked. Changing
-- any of them clears it, unless the same update is the one setting a new verification.
create function public.reset_claim_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.text, new.certainty, new.sensitive) is distinct from (old.text, old.certainty, old.sensitive)
     and new.verified_at is not distinct from old.verified_at then
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

create trigger claims_reset_verification
  before update on public.claims
  for each row execute function public.reset_claim_verification();

create function public.reset_claim_verification_on_sources()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.claims
     set verified_at = null, verified_by = null
   where id = coalesce(new.claim_id, old.claim_id)
     and verified_at is not null;
  return null;
end;
$$;

create trigger claim_sources_reset_verification
  after insert or delete on public.claim_sources
  for each row execute function public.reset_claim_verification_on_sources();
