begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role) values
  ('e5000000-0000-4000-8000-000000000001', 'media-editor@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('e5000000-0000-4000-8000-000000000001', 'editor');

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

insert into public.opportunities (id, topic, status, decision_reason)
values ('0b500000-0000-4000-8000-000000000001', 'Media', 'accepted', 'ok');
insert into public.scripts (id, opportunity_id, version, status) values
  ('5c500000-0000-4000-8000-000000000001', '0b500000-0000-4000-8000-000000000001', 1, 'approved'),
  ('5c500000-0000-4000-8000-000000000002', '0b500000-0000-4000-8000-000000000001', 2, 'in_review');

select pg_temp.login('e5000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.media_projects (script_id) values ('5c500000-0000-4000-8000-000000000002')$$,
  '23514', 'only approved scripts become videos',
  'a script in review cannot become a video'
);
insert into public.media_projects (id, script_id)
values ('3e500000-0000-4000-8000-000000000001', '5c500000-0000-4000-8000-000000000001');
select throws_ok(
  $$update public.media_projects set status = 'rendered' where id = '3e500000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'an editor cannot mark a project rendered'
);
select lives_ok(
  $$update public.media_projects set status = 'queued' where id = '3e500000-0000-4000-8000-000000000001'$$,
  'an editor queues a project'
);
select throws_ok(
  $$update public.media_projects set brand = 'Otro' where id = '3e500000-0000-4000-8000-000000000001'$$,
  '23514', 'the project is being rendered',
  'a queued project cannot be edited'
);
select throws_ok(
  $$insert into public.renders (project_id, version, profile, storage_path, checksum, size_bytes,
      duration_ms, width, height, video_codec, qc_passed, qc_report, manifest, manifest_path,
      disclosure_required)
    values ('3e500000-0000-4000-8000-000000000001', 1, 'master', 'renders/x.mp4', repeat('a', 64),
      1, 1, 1080, 1920, 'h264', true, '{}', '{}', 'renders/x.json', true)$$,
  '42501', null,
  'clients cannot write renders'
);
select is(
  (select count(*)::int from public.media_projects where id = '3e500000-0000-4000-8000-000000000001'),
  1,
  'members read projects'
);
select pg_temp.logout();

select * from finish();
rollback;
