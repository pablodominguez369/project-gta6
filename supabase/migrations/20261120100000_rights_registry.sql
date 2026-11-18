-- Rights registry (Phase 3, T20): licenses, assets and the private media bucket.
-- Only `original` and `cleared` assets can end up in a publishable render (rule 3). Rights
-- statuses are set by rights reviewers or admins; editors can only register assets for review.

create type public.rights_status as enum (
  'original', 'cleared', 'requires_permission', 'unknown', 'restricted', 'expired', 'disputed'
);
create type public.asset_kind as enum ('image', 'video', 'audio', 'music', 'font', 'voice');
create type public.asset_origin as enum (
  'original_work', 'ai_generated', 'own_capture', 'official', 'licensed'
);

create table public.licenses (
  id                      uuid primary key default gen_random_uuid(),
  licensor                text not null check (char_length(licensor) between 1 and 200),
  terms_url               text check (terms_url ~ '^https://' and char_length(terms_url) <= 2000),
  -- Path of the signed agreement or proof inside the private `media` bucket (licenses/...).
  proof_path              text check (proof_path ~ '^licenses/' and char_length(proof_path) <= 500),
  scope                   text not null check (char_length(scope) between 3 and 2000),
  allowed_platforms       public.platform[] not null check (cardinality(allowed_platforms) >= 1),
  commercial_allowed      boolean not null default false,
  allowed_transformations text not null default '' check (char_length(allowed_transformations) <= 1000),
  territory               text not null check (char_length(territory) between 2 and 200),
  valid_from              timestamptz,
  expires_at              timestamptz,
  notes                   text not null default '' check (char_length(notes) <= 2000),
  created_by              uuid default auth.uid() references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint licenses_valid_period check (valid_from is null or expires_at is null or valid_from < expires_at)
);

comment on table public.licenses is
  'Written permissions and stock licenses. A license does not make an asset usable by itself: '
  'a rights reviewer links it to the asset and clears it.';

alter table public.licenses enable row level security;
revoke all on table public.licenses from anon;
revoke delete, truncate on table public.licenses from authenticated;

create trigger licenses_keep_created_by
  before update on public.licenses
  for each row execute function public.keep_created_by();

create trigger licenses_set_updated_at
  before update on public.licenses
  for each row execute function public.set_updated_at();

create trigger licenses_audit
  after insert or update on public.licenses
  for each row execute function public.audit_row_change();

create policy "licenses: members read"
  on public.licenses for select to authenticated
  using ((select public.is_member()));

create policy "licenses: rights reviewers create"
  on public.licenses for insert to authenticated
  with check ((select public.has_any_role(array['admin', 'rights_reviewer']::public.app_role[])));

create policy "licenses: rights reviewers update"
  on public.licenses for update to authenticated
  using ((select public.has_any_role(array['admin', 'rights_reviewer']::public.app_role[])))
  with check ((select public.has_any_role(array['admin', 'rights_reviewer']::public.app_role[])));

create table public.assets (
  id                 uuid primary key default gen_random_uuid(),
  kind               public.asset_kind not null,
  origin             public.asset_origin not null,
  title              text not null check (char_length(title) between 1 and 200),
  owner              text not null check (char_length(owner) between 1 and 200),
  source_url         text check (source_url ~ '^https://' and char_length(source_url) <= 2000),
  license_id         uuid references public.licenses (id) on delete restrict,
  rights_status      public.rights_status not null default 'unknown',
  rights_note        text not null default '' check (char_length(rights_note) <= 1000),
  attribution        text not null default '' check (char_length(attribution) <= 500),
  -- File in the private `media` bucket (assets/...). Immutable: a new file is a new asset.
  storage_path       text not null unique check (storage_path ~ '^assets/' and char_length(storage_path) <= 500),
  content_hash       text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  mime_type          text not null check (char_length(mime_type) <= 100),
  size_bytes         bigint not null check (size_bytes between 1 and 209715200),
  metadata           jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  reviewed_by        uuid references auth.users (id) on delete set null,
  reviewed_at        timestamptz,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Own gameplay, official material and stock are never "original": they need a license.
  constraint assets_original_is_self_owned
    check (rights_status <> 'original' or origin in ('original_work', 'ai_generated')),
  constraint assets_cleared_has_license
    check (rights_status <> 'cleared' or license_id is not null),
  constraint assets_usable_was_reviewed
    check (rights_status not in ('original', 'cleared') or reviewed_by is not null)
);

comment on column public.assets.rights_status is
  'Only original/cleared assets may be rendered for publication; every other status blocks.';

create index assets_rights_status_idx on public.assets (rights_status);
create index assets_license_idx on public.assets (license_id);
create index assets_content_hash_idx on public.assets (content_hash);

alter table public.assets enable row level security;
revoke all on table public.assets from anon;
revoke delete, truncate on table public.assets from authenticated;

create trigger assets_keep_created_by
  before update on public.assets
  for each row execute function public.keep_created_by();

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- Rights decisions belong to rights reviewers and admins. Server code using the secret key
-- (no auth.uid()) is trusted. The file, its hash and its origin never change after upload.
create function public.guard_asset_rights()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  is_reviewer boolean := public.has_any_role(array['admin', 'rights_reviewer']::public.app_role[]);
begin
  if tg_op = 'UPDATE' and (
       new.storage_path is distinct from old.storage_path
       or new.content_hash is distinct from old.content_hash
       or new.mime_type is distinct from old.mime_type
       or new.size_bytes is distinct from old.size_bytes
       or new.origin is distinct from old.origin
       or new.kind is distinct from old.kind) then
    raise exception 'asset files and origins are immutable; register a new asset'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    new.reviewed_by := null;
    new.reviewed_at := null;
    if actor is not null and not is_reviewer then
      -- Editors register; the reviewer decides. Material that needs permission says so.
      new.rights_status := case when new.origin in ('own_capture', 'official', 'licensed')
                                then 'requires_permission'::public.rights_status
                                else 'unknown'::public.rights_status end;
      new.license_id := null;
      return new;
    end if;
  elsif new.rights_status is not distinct from old.rights_status
        and new.license_id is not distinct from old.license_id then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    return new;
  elsif actor is not null and not is_reviewer then
    raise exception 'only rights reviewers change rights' using errcode = 'insufficient_privilege';
  end if;

  if new.rights_status in ('original', 'cleared') then
    new.reviewed_by := coalesce(actor, new.reviewed_by);
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_asset_rights() from public, anon, authenticated;

create trigger assets_guard_rights
  before insert or update on public.assets
  for each row execute function public.guard_asset_rights();

create trigger assets_audit
  after insert or update on public.assets
  for each row execute function public.audit_row_change();

create policy "assets: members read"
  on public.assets for select to authenticated
  using ((select public.is_member()));

create policy "assets: editors and reviewers register"
  on public.assets for insert to authenticated
  with check (
    (select public.has_any_role(array['admin', 'editor', 'rights_reviewer']::public.app_role[]))
    and created_by = (select auth.uid())
  );

create policy "assets: editors and reviewers update"
  on public.assets for update to authenticated
  using ((select public.has_any_role(array['admin', 'editor', 'rights_reviewer']::public.app_role[])))
  with check ((select public.has_any_role(array['admin', 'editor', 'rights_reviewer']::public.app_role[])));

-- Private bucket for assets, license proofs and renders. Files are read through short-lived
-- signed URLs created on the server; nothing is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false, 209715200,
  array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav',
        'audio/x-wav', 'font/ttf', 'font/otf', 'application/pdf', 'application/json',
        'text/plain']
)
on conflict (id) do nothing;

create policy "media: members read"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and (select public.is_member()));

create policy "media: editors upload assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and name like 'assets/%'
    and (select public.has_any_role(array['admin', 'editor', 'rights_reviewer']::public.app_role[]))
  );

create policy "media: rights reviewers upload license proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and name like 'licenses/%'
    and (select public.has_any_role(array['admin', 'rights_reviewer']::public.app_role[]))
  );
-- No update/delete policies: stored files are immutable for clients. Renders are written by
-- the worker with the secret key.
