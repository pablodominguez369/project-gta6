begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Test users ---------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'admin@example.test', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'reader@example.test', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'publisher@example.test', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'outsider@example.test', 'authenticated', 'authenticated');

insert into public.user_roles (user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'read_only'),
  ('33333333-3333-4333-8333-333333333333', 'publisher');

create function pg_temp.login(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- RLS is enabled on every table in public ------------------------------------
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has RLS enabled'
);

-- anon sees nothing ---------------------------------------------------------
set local role anon;
select throws_ok(
  'select * from public.channels',
  '42501',
  null,
  'anon has no privileges on channels'
);
select throws_ok(
  'select * from public.system_controls',
  '42501',
  null,
  'anon has no privileges on system_controls'
);
select pg_temp.logout();

-- Outsider (authenticated, no role) sees nothing -----------------------------
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select is((select count(*)::int from public.channels), 0, 'user without role sees no channels');
select is((select count(*)::int from public.system_controls), 0, 'user without role sees no controls');
select pg_temp.logout();

-- read_only ---------------------------------------------------------------
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select ok((select count(*) from public.channels) >= 1, 'read_only can read channels');
select throws_ok(
  $$insert into public.channels (platform, display_name) values ('simulated', 'nope')$$,
  '42501',
  null,
  'read_only cannot create channels'
);
select is_empty(
  $$update public.system_controls set global_paused = true returning id$$,
  'read_only cannot pause the system'
);
select is_empty(
  $$update public.channels set paused = true returning id$$,
  'read_only cannot pause channels'
);
select throws_ok(
  $$insert into public.user_roles (user_id, role) values ('22222222-2222-4222-8222-222222222222', 'admin')$$,
  '42501',
  null,
  'read_only cannot grant itself admin'
);
select is((select count(*)::int from public.credential_refs), 0, 'read_only cannot read credential refs');
select is((select count(*)::int from public.audit_events), 0, 'read_only cannot read the audit log');
select is(
  (select count(*)::int from public.user_roles),
  1,
  'read_only sees only its own role assignment'
);
select pg_temp.logout();

-- publisher ---------------------------------------------------------------
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select lives_ok(
  $$insert into public.publications (channel_id, idempotency_key)
    values ('00000000-0000-4000-8000-000000000001', 'test-key-publisher-1')$$,
  'publisher can enqueue a publication'
);
select throws_ok(
  $$insert into public.publications (channel_id, idempotency_key, status, external_id)
    values ('00000000-0000-4000-8000-000000000001', 'test-key-publisher-2', 'succeeded', 'x')$$,
  '42501',
  null,
  'publisher cannot insert a publication as already succeeded'
);
select is_empty(
  $$update public.publications set status = 'succeeded', external_id = 'x' returning id$$,
  'publisher cannot change publication status'
);
select pg_temp.logout();

-- admin -------------------------------------------------------------------
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$update public.system_controls set global_paused = true, paused_reason = 'test'$$,
  'admin can pause the system'
);
select lives_ok(
  $$insert into public.channels (platform, display_name) values ('simulated', 'Admin channel')$$,
  'admin can create channels'
);
select throws_ok(
  $$insert into public.channels (platform, display_name, mode) values ('simulated', 'x', 'autopublish')$$,
  '23514',
  null,
  'autopublish is rejected in Phase 1'
);
select throws_ok(
  $$insert into public.channels (platform, display_name, timezone) values ('simulated', 'x', 'Mars/Olympus')$$,
  '23514',
  null,
  'invalid IANA time zone is rejected'
);
select throws_ok(
  $$insert into public.credential_refs (channel_id, secret_ref)
    values ('00000000-0000-4000-8000-000000000001', 'ya29.plain-token-not-a-reference')$$,
  '23514',
  null,
  'credential_refs rejects values that are not reference URIs'
);
select ok(
  (select count(*) from public.audit_events where action = 'system_controls.update'
     and actor_id = '11111111-1111-4111-8111-111111111111') = 1,
  'pausing the system writes an audit event with the admin as actor'
);
select pg_temp.logout();

select * from finish();
rollback;
