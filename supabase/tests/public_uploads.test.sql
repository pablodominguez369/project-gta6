begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, aud, role) values
  ('e8000000-0000-4000-8000-000000000001', 'admin-public@example.test', 'authenticated', 'authenticated'),
  ('e8000000-0000-4000-8000-000000000002', 'pub-public@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('e8000000-0000-4000-8000-000000000001', 'admin'),
  ('e8000000-0000-4000-8000-000000000002', 'publisher');

insert into public.channels (id, platform, display_name) values
  ('c8000000-0000-4000-8000-000000000001', 'youtube', 'YT public'),
  ('c8000000-0000-4000-8000-000000000002', 'instagram', 'IG public');

create function pg_temp.login(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.login('e8000000-0000-4000-8000-000000000001');

select throws_ok(
  $$update public.channels set public_uploads_enabled = true
     where id = 'c8000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'public posts need the owner''s authorization recorded'
);

select throws_ok(
  $$update public.channels set public_uploads_enabled = true,
       public_uploads_authorization = 'Autorización escrita del responsable, 2026-11-19'
     where id = 'c8000000-0000-4000-8000-000000000002'$$,
  '23514', null,
  'instagram cannot be switched to public posts'
);

select lives_ok(
  $$update public.channels set public_uploads_enabled = true,
       public_uploads_authorization = 'Autorización escrita del responsable, 2026-11-19'
     where id = 'c8000000-0000-4000-8000-000000000001'$$,
  'an admin can switch on public posts with the authorization'
);

select pg_temp.login('e8000000-0000-4000-8000-000000000002');
update public.channels set public_uploads_enabled = false
 where id = 'c8000000-0000-4000-8000-000000000001';
reset role;
select is(
  (select public_uploads_enabled from public.channels
    where id = 'c8000000-0000-4000-8000-000000000001'),
  true,
  'a publisher cannot change the public switch'
);

select ok(
  exists (select 1 from public.audit_events
           where action = 'channels.update'
             and object_id = 'c8000000-0000-4000-8000-000000000001'
             and safe_details->'changed_columns' ? 'public_uploads_enabled'),
  'the switch is audited'
);

select * from finish();
rollback;
