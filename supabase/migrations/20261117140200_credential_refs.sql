-- References to platform credentials. The secret itself lives in the secret manager;
-- this table only stores a reference URI such as "vault://youtube/channel-1".

create type public.credential_status as enum ('pending', 'active', 'expired', 'revoked');

create table public.credential_refs (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  secret_ref text not null check (secret_ref ~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._/-]+$'),
  scopes     text[] not null default '{}',
  status     public.credential_status not null default 'pending',
  granted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credential_refs_expiry_after_grant
    check (expires_at is null or granted_at is null or expires_at > granted_at)
);

comment on table public.credential_refs is
  'Reference only: never store tokens here. secret_ref points to the secret manager.';

alter table public.credential_refs enable row level security;
revoke all on table public.credential_refs from anon;

create trigger credential_refs_set_updated_at
  before update on public.credential_refs
  for each row execute function public.set_updated_at();

create policy "credential_refs: admins only"
  on public.credential_refs for all
  to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));
