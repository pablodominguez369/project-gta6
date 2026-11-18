begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role) values
  ('e8000000-0000-4000-8000-000000000001', 'pub-manual@example.test', 'authenticated', 'authenticated'),
  ('e8000000-0000-4000-8000-000000000002', 'editor-manual@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('e8000000-0000-4000-8000-000000000001', 'publisher'),
  ('e8000000-0000-4000-8000-000000000002', 'editor');

insert into public.channels (id, platform, display_name, mode)
values ('c8000000-0000-4000-8000-000000000001', 'instagram', 'IG manual', 'manual');
insert into public.publications (id, channel_id, idempotency_key, status)
values
  ('9a800000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', 'pgtap-manual-1', 'awaiting_manual'),
  ('9a800000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000001', 'pgtap-manual-2', 'queued');

create function pg_temp.login(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.login('e8000000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.complete_manual_publication('9a800000-0000-4000-8000-000000000001', 'https://www.instagram.com/reel/abc/')$$,
  '42501', null,
  'an editor cannot record a manual upload'
);

select pg_temp.login('e8000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.complete_manual_publication('9a800000-0000-4000-8000-000000000001', 'javascript:alert(1)')$$,
  '23514', null,
  'only https permalinks'
);
select throws_ok(
  $$select public.complete_manual_publication('9a800000-0000-4000-8000-000000000002', 'https://www.instagram.com/reel/abc/')$$,
  'P0002', null,
  'a publication that is not waiting for a manual upload cannot be completed'
);
select lives_ok(
  $$select public.complete_manual_publication('9a800000-0000-4000-8000-000000000001', 'https://www.instagram.com/reel/abc/')$$,
  'a publisher records the manual upload'
);
select results_eq(
  $$select status::text, permalink from public.publications where id = '9a800000-0000-4000-8000-000000000001'$$,
  $$values ('succeeded', 'https://www.instagram.com/reel/abc/')$$,
  'the publication is succeeded with its permalink'
);

reset role;
select is(
  (select count(*)::int from public.audit_events
    where action = 'publications.manual_completed' and object_id = '9a800000-0000-4000-8000-000000000001'),
  1,
  'the manual upload is audited'
);

select * from finish();
rollback;
