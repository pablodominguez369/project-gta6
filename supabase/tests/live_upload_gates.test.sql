begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, aud, role) values
  ('e7000000-0000-4000-8000-000000000001', 'admin-live@example.test', 'authenticated', 'authenticated'),
  ('e7000000-0000-4000-8000-000000000002', 'pub-live@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('e7000000-0000-4000-8000-000000000001', 'admin'),
  ('e7000000-0000-4000-8000-000000000002', 'publisher');

insert into public.channels (id, platform, display_name)
values ('c7000000-0000-4000-8000-000000000001', 'youtube', 'YT live gates');

create function pg_temp.login(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.login('e7000000-0000-4000-8000-000000000001');

select throws_ok(
  $$update public.channels set upload_visibility = 'public'
     where id = 'c7000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'public uploads are rejected in Phase 4'
);

select throws_ok(
  $$update public.channels set live_uploads_enabled = true
     where id = 'c7000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'switching on real uploads needs a reason'
);

select lives_ok(
  $$update public.channels set live_uploads_enabled = true, live_uploads_reason = 'Prueba privada autorizada'
     where id = 'c7000000-0000-4000-8000-000000000001'$$,
  'an admin switches on private real uploads with a reason'
);

select throws_ok(
  $$update public.channels set live_uploads_enabled = true, live_uploads_reason = 'nope'
     where id = '00000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'the simulator cannot have real uploads'
);

select pg_temp.login('e7000000-0000-4000-8000-000000000002');

select throws_ok(
  $$insert into public.publications (channel_id, idempotency_key, payload_json, platform_checkpoint)
    values ('c7000000-0000-4000-8000-000000000001', 'pgtap-live-1', '{}', '{"sessionUri": "x"}')$$,
  '42501', null,
  'a member cannot forge a checkpoint'
);

select lives_ok(
  $$insert into public.publications (channel_id, idempotency_key, payload_json)
    values ('c7000000-0000-4000-8000-000000000001', 'pgtap-live-2', '{}')$$,
  'a publisher enqueues without a checkpoint'
);

select lives_ok(
  $$select id, status, permalink from public.publications where idempotency_key = 'pgtap-live-2'$$,
  'members still read the publication columns'
);

select throws_ok(
  $$select platform_checkpoint from public.publications$$,
  '42501', null,
  'members cannot read the upload checkpoint'
);

select * from finish();
rollback;
