begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role) values
  ('e2000000-0000-4000-8000-000000000001', 'sr-editor@example.test', 'authenticated', 'authenticated'),
  ('c2000000-0000-4000-8000-000000000001', 'sr-reader@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('e2000000-0000-4000-8000-000000000001', 'editor'),
  ('c2000000-0000-4000-8000-000000000001', 'read_only');

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

insert into public.opportunities (id, topic, status, decision_reason) values
  ('0c000000-0000-4000-8000-000000000001', 'Accepted', 'accepted', 'ok'),
  ('0c000000-0000-4000-8000-000000000002', 'New', 'new', null);

select pg_temp.login('e2000000-0000-4000-8000-000000000001');
select lives_ok(
  $$insert into public.script_requests (opportunity_id, requested_by)
    values ('0c000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001')$$,
  'an editor requests a draft for an accepted opportunity'
);
select throws_ok(
  $$insert into public.script_requests (opportunity_id, requested_by)
    values ('0c000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001')$$,
  '23505', null,
  'only one open request per opportunity'
);
select throws_ok(
  $$insert into public.script_requests (opportunity_id, requested_by)
    values ('0c000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'opportunities that are not accepted cannot be drafted'
);
select throws_ok(
  $$insert into public.script_requests (opportunity_id, requested_by, status)
    values ('0c000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'succeeded')$$,
  '42501', null,
  'clients cannot insert a finished request'
);
select is_empty(
  $$update public.script_requests set status = 'succeeded' returning id$$,
  'clients cannot change a request'
);
select pg_temp.logout();

select pg_temp.login('c2000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.script_requests (opportunity_id, requested_by)
    values ('0c000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'read_only cannot request drafts'
);
select pg_temp.logout();

select * from finish();
rollback;
