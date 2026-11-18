-- Synthetic voices (Phase 3, T22). A voice can only narrate once a rights reviewer approves it
-- with its license recorded; a voice that imitates a real person also needs proof of consent
-- (rule 5). Synthetic speech is always disclosed unless the reviewer records why not.

create table public.voices (
  id                     uuid primary key default gen_random_uuid(),
  provider               text not null check (provider ~ '^[a-z][a-z0-9_-]{1,49}$'),
  provider_voice_id      text not null check (char_length(provider_voice_id) between 1 and 200),
  display_name           text not null check (char_length(display_name) between 1 and 100),
  locale                 text not null default 'es-ES' check (locale in ('es-ES', 'es-419')),
  license_id             uuid references public.licenses (id) on delete restrict,
  -- True when the voice imitates an identifiable person (cloned or "sounds like").
  imitates_real_person   boolean not null default false,
  consent_proof_path     text check (consent_proof_path ~ '^licenses/' and char_length(consent_proof_path) <= 500),
  disclosure_required    boolean not null default true,
  disclosure_note        text not null default '' check (char_length(disclosure_note) <= 500),
  -- Kept for the audit trail: a reviewer who approved a voice cannot be deleted.
  approved_by            uuid references auth.users (id) on delete restrict,
  approved_at            timestamptz,
  revoked_at             timestamptz,
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (provider, provider_voice_id),
  constraint voices_approval_complete check ((approved_at is null) = (approved_by is null)),
  -- The fake development provider needs no license; every real provider does.
  constraint voices_approved_has_license
    check (approved_at is null or provider = 'fake' or license_id is not null),
  constraint voices_imitation_has_consent
    check (approved_at is null or not imitates_real_person or consent_proof_path is not null),
  constraint voices_no_disclosure_explained
    check (disclosure_required or char_length(disclosure_note) >= 10)
);

comment on table public.voices is
  'Voices the TTS may use. Usable only when approved and not revoked (rule 5).';

alter table public.voices enable row level security;
revoke all on table public.voices from anon;
revoke delete, truncate on table public.voices from authenticated;

create trigger voices_keep_created_by
  before update on public.voices
  for each row execute function public.keep_created_by();

create trigger voices_set_updated_at
  before update on public.voices
  for each row execute function public.set_updated_at();

-- Any change to what was approved withdraws the approval; the reviewer is always the caller.
create function public.guard_voice_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.approved_at is not null then
      new.approved_by := coalesce((select auth.uid()), new.approved_by);
    end if;
    return new;
  end if;
  if (new.provider, new.provider_voice_id, new.license_id, new.imitates_real_person,
      new.consent_proof_path, new.disclosure_required, new.locale)
     is distinct from
     (old.provider, old.provider_voice_id, old.license_id, old.imitates_real_person,
      old.consent_proof_path, old.disclosure_required, old.locale)
     and new.approved_at is not distinct from old.approved_at then
    new.approved_at := null;
    new.approved_by := null;
  elsif new.approved_at is distinct from old.approved_at and new.approved_at is not null then
    new.approved_by := coalesce((select auth.uid()), new.approved_by);
  end if;
  return new;
end;
$$;

create trigger voices_guard_approval
  before insert or update on public.voices
  for each row execute function public.guard_voice_approval();

create trigger voices_audit
  after insert or update on public.voices
  for each row execute function public.audit_row_change();

create policy "voices: members read"
  on public.voices for select to authenticated
  using ((select public.is_member()));

create policy "voices: rights reviewers create"
  on public.voices for insert to authenticated
  with check ((select public.has_any_role(array['admin', 'rights_reviewer']::public.app_role[])));

create policy "voices: rights reviewers update"
  on public.voices for update to authenticated
  using ((select public.has_any_role(array['admin', 'rights_reviewer']::public.app_role[])))
  with check ((select public.has_any_role(array['admin', 'rights_reviewer']::public.app_role[])));
