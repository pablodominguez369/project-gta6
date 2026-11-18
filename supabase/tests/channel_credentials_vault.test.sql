begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, aud, role) values
  ('e9000000-0000-4000-8000-000000000001', 'admin-vault@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('e9000000-0000-4000-8000-000000000001', 'admin');
insert into public.channels (id, platform, display_name)
values ('c9000000-0000-4000-8000-000000000001', 'youtube', 'YT vault');

select throws_ok(
  $$select public.store_channel_credential('00000000-0000-4000-8000-000000000001', '{}', '{}', null)$$,
  '23514', null,
  'the simulator has no credentials'
);

select lives_ok(
  $$select public.store_channel_credential('c9000000-0000-4000-8000-000000000001',
      '{"accessToken":"first"}', array['scope.a'], 'e9000000-0000-4000-8000-000000000001')$$,
  'the service stores a credential in Vault'
);
select is(
  public.read_vault_secret((select secret_ref from public.credential_refs
                             where channel_id = 'c9000000-0000-4000-8000-000000000001' and status = 'active')),
  '{"accessToken":"first"}',
  'the secret is readable through its reference'
);

select public.store_channel_credential('c9000000-0000-4000-8000-000000000001',
  '{"accessToken":"second"}', array['scope.a'], 'e9000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from public.credential_refs
    where channel_id = 'c9000000-0000-4000-8000-000000000001' and status = 'active'),
  1,
  'a new connection revokes the previous credential'
);
select is(
  (select count(*)::int from public.credential_refs cr
     join vault.secrets s on s.id = public.vault_secret_id(cr.secret_ref)
    where cr.channel_id = 'c9000000-0000-4000-8000-000000000001'),
  1,
  'the revoked secret is deleted from Vault'
);
select is(
  (select count(*)::int from public.audit_events
    where action = 'channels.account_connected' and object_id = 'c9000000-0000-4000-8000-000000000001'),
  2,
  'each connection is audited'
);

-- Members cannot call any of the functions.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e9000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select public.read_vault_secret('vault://00000000-0000-4000-8000-000000000000')$$,
  '42501', null,
  'an admin session cannot read secrets'
);
select throws_ok(
  $$select public.store_channel_credential('c9000000-0000-4000-8000-000000000001', '{}', '{}', null)$$,
  '42501', null,
  'an admin session cannot store credentials directly'
);
reset role;

select public.revoke_channel_credentials('c9000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from public.credential_refs
    where channel_id = 'c9000000-0000-4000-8000-000000000001' and status <> 'revoked'),
  0,
  'disconnecting revokes every credential'
);

select * from finish();
rollback;
