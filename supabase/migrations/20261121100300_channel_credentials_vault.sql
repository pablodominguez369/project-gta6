-- Phase 4 (T31): platform OAuth tokens live in Supabase Vault (ADR 0005). credential_refs only
-- keeps "vault://<secret id>". Every function here is security definer and executable by the
-- service role only: the web app calls them with the secret key after checking the admin, and
-- the worker through its direct connection. No member can read or write a secret.

create function public.vault_secret_id(secret_ref text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when secret_ref ~ '^vault://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then substring(secret_ref from 9)::uuid end;
$$;

create function public.read_vault_secret(secret_ref text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  value text;
begin
  select s.decrypted_secret into value
    from vault.decrypted_secrets s
   where s.id = public.vault_secret_id(read_vault_secret.secret_ref);
  return value;
end;
$$;

create function public.update_vault_secret(secret_ref text, secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_id uuid := public.vault_secret_id(update_vault_secret.secret_ref);
begin
  if secret_id is null or not exists (select 1 from vault.secrets s where s.id = secret_id) then
    raise exception 'unknown vault secret' using errcode = 'P0002';
  end if;
  perform vault.update_secret(secret_id, update_vault_secret.secret);
end;
$$;

-- Stores a freshly granted token set for a channel, revokes the previous credentials and deletes
-- their secrets, so a channel has at most one usable credential.
create function public.store_channel_credential(
  channel_id uuid,
  secret text,
  scopes text[],
  actor_id uuid,
  expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_platform public.platform;
  secret_id uuid;
  credential_id uuid;
  old_ref record;
begin
  select c.platform into target_platform
    from public.channels c where c.id = store_channel_credential.channel_id
   for update;
  if not found or target_platform = 'simulated' then
    raise exception 'credentials are only stored for real platform channels'
      using errcode = 'check_violation';
  end if;

  for old_ref in
    select cr.id, cr.secret_ref from public.credential_refs cr
     where cr.channel_id = store_channel_credential.channel_id and cr.status <> 'revoked'
  loop
    update public.credential_refs set status = 'revoked' where id = old_ref.id;
    delete from vault.secrets where id = public.vault_secret_id(old_ref.secret_ref);
  end loop;

  secret_id := vault.create_secret(
    store_channel_credential.secret,
    'channel-credential-' || gen_random_uuid()::text,
    'OAuth tokens for channel ' || store_channel_credential.channel_id::text
  );

  insert into public.credential_refs (channel_id, secret_ref, scopes, status, granted_at, expires_at)
  values (store_channel_credential.channel_id, 'vault://' || secret_id::text,
          store_channel_credential.scopes, 'active', now(), store_channel_credential.expires_at)
  returning id into credential_id;

  insert into public.audit_events (actor_id, actor_type, action, object_type, object_id, safe_details)
  values (store_channel_credential.actor_id, 'user', 'channels.account_connected', 'channels',
          store_channel_credential.channel_id::text,
          jsonb_build_object('platform', target_platform,
                             'scopes', array_to_string(store_channel_credential.scopes, ' ')));
  return credential_id;
end;
$$;

-- Admins disconnect an account; the secret is deleted at once.
create function public.revoke_channel_credentials(channel_id uuid, actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_ref record;
begin
  for old_ref in
    select cr.id, cr.secret_ref from public.credential_refs cr
     where cr.channel_id = revoke_channel_credentials.channel_id and cr.status <> 'revoked'
  loop
    update public.credential_refs set status = 'revoked' where id = old_ref.id;
    delete from vault.secrets where id = public.vault_secret_id(old_ref.secret_ref);
  end loop;
  update public.channels set live_uploads_enabled = false
   where id = revoke_channel_credentials.channel_id;
  insert into public.audit_events (actor_id, actor_type, action, object_type, object_id, safe_details)
  values (revoke_channel_credentials.actor_id, 'user', 'channels.account_disconnected', 'channels',
          revoke_channel_credentials.channel_id::text, '{}'::jsonb);
end;
$$;

revoke execute on function public.read_vault_secret(text) from public, anon, authenticated;
revoke execute on function public.update_vault_secret(text, text) from public, anon, authenticated;
revoke execute on function public.store_channel_credential(uuid, text, text[], uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.revoke_channel_credentials(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_vault_secret(text) to service_role;
grant execute on function public.update_vault_secret(text, text) to service_role;
grant execute on function public.store_channel_credential(uuid, text, text[], uuid, timestamptz)
  to service_role;
grant execute on function public.revoke_channel_credentials(uuid, uuid) to service_role;
