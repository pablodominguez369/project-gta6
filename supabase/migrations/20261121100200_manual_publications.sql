-- Phase 4 (T30): an operator records a manual upload. Members have no UPDATE policy on
-- publications, so this function is the only way a person changes a publication's state.

comment on column public.publications.status is
  'ambiguous = outcome unknown after a timeout; external state must be reconciled before any retry. '
  'awaiting_manual = gates passed on a manual channel; a person uploads the package by hand.';

create function public.complete_manual_publication(publication_id uuid, permalink text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_platform public.platform;
begin
  if actor is null
     or not public.has_any_role(array['admin', 'publisher']::public.app_role[]) then
    raise exception 'only admins and publishers record manual uploads'
      using errcode = 'insufficient_privilege';
  end if;
  if permalink is null or char_length(permalink) > 500 or permalink !~ '^https://[^\s]+$' then
    raise exception 'the permalink must be an https URL' using errcode = 'check_violation';
  end if;

  select c.platform into target_platform
    from public.publications p join public.channels c on c.id = p.channel_id
   where p.id = complete_manual_publication.publication_id
     and p.status = 'awaiting_manual'
   for update of p;
  if not found then
    raise exception 'publication is not waiting for a manual upload' using errcode = 'P0002';
  end if;

  update public.publications p
     set status = 'succeeded',
         external_id = 'manual:' || p.id::text,
         permalink = complete_manual_publication.permalink,
         published_at = now(),
         error_code = null,
         next_attempt_at = null
   where p.id = complete_manual_publication.publication_id;

  insert into public.audit_events (actor_id, actor_type, action, object_type, object_id, safe_details)
  values (actor, 'user', 'publications.manual_completed', 'publications',
          complete_manual_publication.publication_id::text,
          jsonb_build_object('platform', target_platform));
end;
$$;

revoke execute on function public.complete_manual_publication(uuid, text) from public, anon;
grant execute on function public.complete_manual_publication(uuid, text) to authenticated;
