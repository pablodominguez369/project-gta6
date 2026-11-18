begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, aud, role) values
  ('e2000000-0000-4000-8000-000000000001', 'rights-editor@example.test', 'authenticated', 'authenticated'),
  ('e2000000-0000-4000-8000-000000000002', 'rights-reviewer@example.test', 'authenticated', 'authenticated'),
  ('e2000000-0000-4000-8000-000000000009', 'rights-reader@example.test', 'authenticated', 'authenticated');

insert into public.user_roles (user_id, role) values
  ('e2000000-0000-4000-8000-000000000001', 'editor'),
  ('e2000000-0000-4000-8000-000000000002', 'rights_reviewer'),
  ('e2000000-0000-4000-8000-000000000009', 'read_only');

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

-- Editors register; the database decides the initial status --------------------
select pg_temp.login('e2000000-0000-4000-8000-000000000001');
insert into public.assets (id, kind, origin, title, owner, storage_path, content_hash, mime_type, size_bytes, rights_status)
values
  ('a2000000-0000-4000-8000-000000000001', 'image', 'official', 'Tráiler captura', 'Estudio',
   'assets/a1.png', repeat('a', 64), 'image/png', 10, 'cleared'),
  ('a2000000-0000-4000-8000-000000000002', 'image', 'original_work', 'Fondo propio', 'Equipo',
   'assets/a2.png', repeat('b', 64), 'image/png', 10, 'original');
select pg_temp.logout();

select is(
  (select rights_status::text from public.assets where id = 'a2000000-0000-4000-8000-000000000001'),
  'requires_permission',
  'official material registered by an editor starts as requires_permission'
);
select is(
  (select rights_status::text from public.assets where id = 'a2000000-0000-4000-8000-000000000002'),
  'unknown',
  'an editor cannot mark an asset original'
);

select pg_temp.login('e2000000-0000-4000-8000-000000000001');
select throws_ok(
  $$update public.assets set rights_status = 'original' where id = 'a2000000-0000-4000-8000-000000000002'$$,
  '42501', 'only rights reviewers change rights',
  'an editor cannot change a rights status'
);
select lives_ok(
  $$update public.assets set title = 'Fondo propio v2' where id = 'a2000000-0000-4000-8000-000000000002'$$,
  'an editor can fix the title'
);
select throws_ok(
  $$insert into public.licenses (licensor, scope, allowed_platforms, territory)
    values ('Estudio', 'Uso editorial', array['youtube']::public.platform[], 'ES')$$,
  '42501', null,
  'an editor cannot create licenses'
);
select pg_temp.logout();

-- Rights reviewers decide -------------------------------------------------------
select pg_temp.login('e2000000-0000-4000-8000-000000000002');
select lives_ok(
  $$update public.assets set rights_status = 'original' where id = 'a2000000-0000-4000-8000-000000000002'$$,
  'a rights reviewer marks original work as original'
);
select is(
  (select reviewed_by from public.assets where id = 'a2000000-0000-4000-8000-000000000002'),
  'e2000000-0000-4000-8000-000000000002'::uuid,
  'the reviewer is recorded'
);
select throws_ok(
  $$update public.assets set rights_status = 'original' where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'official material can never be original'
);
select throws_ok(
  $$update public.assets set rights_status = 'cleared' where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'clearing needs a license'
);
insert into public.licenses (id, licensor, scope, allowed_platforms, commercial_allowed, territory, expires_at)
values ('12000000-0000-4000-8000-000000000001', 'Estudio', 'Permiso escrito para clips',
        array['youtube']::public.platform[], true, 'Mundial', now() + interval '1 year');
select lives_ok(
  $$update public.assets set rights_status = 'cleared', license_id = '12000000-0000-4000-8000-000000000001'
    where id = 'a2000000-0000-4000-8000-000000000001'$$,
  'a reviewer clears official material with a license'
);
select throws_ok(
  $$update public.assets set content_hash = repeat('c', 64) where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'the file of an asset is immutable'
);
select pg_temp.logout();

-- Read-only users read but never write ---------------------------------------------
select pg_temp.login('e2000000-0000-4000-8000-000000000009');
select is((select count(*)::int from public.assets where id::text like 'a2000000%'), 2, 'members read assets');
select throws_ok(
  $$insert into public.assets (kind, origin, title, owner, storage_path, content_hash, mime_type, size_bytes)
    values ('image', 'original_work', 'x', 'y', 'assets/x.png', repeat('d', 64), 'image/png', 1)$$,
  '42501', null,
  'read-only users cannot register assets'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_events
    where object_type = 'assets' and object_id = 'a2000000-0000-4000-8000-000000000001'),
  2,
  'asset registration and clearing are audited'
);

select * from finish();
rollback;
