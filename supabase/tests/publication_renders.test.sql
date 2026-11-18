begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, aud, role) values
  ('e6000000-0000-4000-8000-000000000001', 'pub-render@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('e6000000-0000-4000-8000-000000000001', 'publisher');

insert into public.opportunities (id, topic, status, decision_reason)
values ('0b600000-0000-4000-8000-000000000001', 'Render pub', 'accepted', 'ok');
insert into public.scripts (id, opportunity_id, version, status)
values ('5c600000-0000-4000-8000-000000000001', '0b600000-0000-4000-8000-000000000001', 1, 'approved');
insert into public.media_projects (id, script_id, status)
values ('3e600000-0000-4000-8000-000000000001', '5c600000-0000-4000-8000-000000000001', 'rendered');
insert into public.renders (id, project_id, version, profile, storage_path, checksum, size_bytes,
    duration_ms, width, height, video_codec, qc_passed, qc_report, manifest, manifest_path,
    disclosure_required)
values
  ('4d600000-0000-4000-8000-000000000001', '3e600000-0000-4000-8000-000000000001', 1, 'master',
   'renders/pgtap/v1/master.mp4', repeat('a', 64), 1, 1, 1080, 1920, 'h264', true, '{}', '{}',
   'renders/pgtap/v1/manifest.json', true),
  ('4d600000-0000-4000-8000-000000000002', '3e600000-0000-4000-8000-000000000001', 2, 'master',
   'renders/pgtap/v2/master.mp4', repeat('b', 64), 1, 1, 1080, 1920, 'h264', false, '{}', '{}',
   'renders/pgtap/v2/manifest.json', true);

create function pg_temp.login(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.login('e6000000-0000-4000-8000-000000000001');

select lives_ok(
  $$insert into public.publications (id, channel_id, idempotency_key, payload_json, render_id)
    values ('9a600000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
            'pgtap-render-1', '{}', '4d600000-0000-4000-8000-000000000001')$$,
  'a publisher links a render that passed QC'
);

select throws_ok(
  $$insert into public.publications (channel_id, idempotency_key, payload_json, render_id)
    values ('00000000-0000-4000-8000-000000000001', 'pgtap-render-2', '{}',
            '4d600000-0000-4000-8000-000000000002')$$,
  '23514',
  'only renders that passed QC can be published',
  'a render that failed QC cannot be published'
);

set local role postgres;
update public.publications set status = 'in_progress'
 where id = '9a600000-0000-4000-8000-000000000001';

select throws_ok(
  $$update public.publications set render_id = null
     where id = '9a600000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'the video of a publication in progress cannot change'
);

select throws_ok(
  $$delete from public.renders where id = '4d600000-0000-4000-8000-000000000001'$$,
  '23503',
  null,
  'a published render cannot be deleted'
);

select * from finish();
rollback;
