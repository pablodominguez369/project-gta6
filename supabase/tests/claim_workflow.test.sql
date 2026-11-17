begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, aud, role) values
  ('e1000000-0000-4000-8000-000000000001', 'claim-editor-one@example.test', 'authenticated', 'authenticated'),
  ('e1000000-0000-4000-8000-000000000002', 'claim-editor-two@example.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000009', 'claim-reader@example.test', 'authenticated', 'authenticated');

insert into public.user_roles (user_id, role) values
  ('e1000000-0000-4000-8000-000000000001', 'editor'),
  ('e1000000-0000-4000-8000-000000000002', 'editor'),
  ('c1000000-0000-4000-8000-000000000009', 'read_only');

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

insert into public.sources (id, url, canonical_url, publisher, title, source_type, trust_level) values
  ('51000000-0000-4000-8000-000000000001', 'https://example.test/cw/1', 'https://example.test/cw/1',
   'Example Press', 'Story', 'press', 2),
  ('51000000-0000-4000-8000-000000000002', 'https://example.test/cw/2', 'https://example.test/cw/2',
   'Other Press', 'Story', 'press', 2);
insert into public.opportunities (id, topic) values
  ('0b000000-0000-4000-8000-000000000001', 'Claim workflow');

-- create_claim ---------------------------------------------------------------
select pg_temp.login('e1000000-0000-4000-8000-000000000001');
create temp table created on commit drop as
select public.create_claim(
  '0b000000-0000-4000-8000-000000000001', 'Two outlets report X', 'reported', true,
  array['51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002',
        '51000000-0000-4000-8000-000000000001']::uuid[]
) as id;
select pg_temp.logout();

select is(
  (select count(*)::int from public.claim_sources where claim_id = (select id from created)),
  2,
  'create_claim links each source once'
);
select is(
  (select created_by from public.claims where id = (select id from created)),
  'e1000000-0000-4000-8000-000000000001'::uuid,
  'create_claim records the caller as author'
);

select pg_temp.login('e1000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.create_claim('0b000000-0000-4000-8000-000000000001', 'Officially confirmed',
      'confirmed', false, array[]::uuid[]);
    set constraints public.claims_require_source immediate$$,
  '23514', 'a confirmed or reported claim needs at least one source',
  'create_claim refuses a factual claim without sources'
);
select pg_temp.logout();

select pg_temp.login('c1000000-0000-4000-8000-000000000009');
select throws_ok(
  $$select public.create_claim('0b000000-0000-4000-8000-000000000001', 'Nope', 'rumor', false, null)$$,
  '42501', null,
  'read_only cannot create claims through create_claim'
);
select pg_temp.logout();

-- Verification ---------------------------------------------------------------
select pg_temp.login('e1000000-0000-4000-8000-000000000002');
select lives_ok(
  $$update public.claims set verified_at = now(), verified_by = 'e1000000-0000-4000-8000-000000000002'
     where id = (select id from created)$$,
  'another editor verifies the claim'
);
select isnt(
  (select verified_at from public.claims where id = (select id from created)),
  null,
  '... and it is verified'
);

update public.claims set text = 'Two outlets report X and Y' where id = (select id from created);
select is(
  (select verified_by from public.claims where id = (select id from created)),
  null,
  'editing the text clears the verification'
);

update public.claims set verified_at = now(), verified_by = 'e1000000-0000-4000-8000-000000000002'
 where id = (select id from created);
delete from public.claim_sources
 where claim_id = (select id from created) and source_id = '51000000-0000-4000-8000-000000000002';
select is(
  (select verified_at from public.claims where id = (select id from created)),
  null,
  'removing a source clears the verification'
);

update public.claims set verified_at = now(), verified_by = 'e1000000-0000-4000-8000-000000000002'
 where id = (select id from created);
update public.claims set sensitive = false where id = (select id from created);
select is(
  (select verified_at from public.claims where id = (select id from created)),
  null,
  'changing the sensitivity clears the verification'
);
select pg_temp.logout();

select * from finish();
rollback;
