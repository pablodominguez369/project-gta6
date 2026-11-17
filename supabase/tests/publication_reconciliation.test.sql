begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, aud, role) values
  ('55555555-5555-4555-8555-555555555555', 'publisher2@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('55555555-5555-4555-8555-555555555555', 'publisher');

insert into public.simulated_platform_posts (idempotency_key, external_id, status)
values ('pgtap-key-1', 'sim_pgtap_1', 'published');

create function pg_temp.login(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.login('55555555-5555-4555-8555-555555555555');

select throws_ok(
  'select * from public.simulated_platform_posts',
  '42501',
  null,
  'signed-in users have no access to the simulated platform table'
);

select lives_ok(
  $$insert into public.publications (channel_id, idempotency_key, payload_json)
    values ('00000000-0000-4000-8000-000000000001', 'pgtap-fresh-1', '{}')$$,
  'a publisher can enqueue a fresh publication'
);

select throws_ok(
  $$insert into public.publications (channel_id, idempotency_key, reconcile_required)
    values ('00000000-0000-4000-8000-000000000001', 'pgtap-fresh-2', true)$$,
  '42501',
  null,
  'clients cannot enqueue with reconcile_required preset'
);

select throws_ok(
  $$insert into public.publications (channel_id, idempotency_key, next_attempt_at)
    values ('00000000-0000-4000-8000-000000000001', 'pgtap-fresh-3', now())$$,
  '42501',
  null,
  'clients cannot enqueue with next_attempt_at preset'
);

set local role anon;
select throws_ok(
  'select * from public.simulated_platform_posts',
  '42501',
  null,
  'anon has no access to the simulated platform table'
);

select * from finish();
rollback;
