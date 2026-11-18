begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, aud, role) values
  ('e3000000-0000-4000-8000-000000000001', 'voice-editor@example.test', 'authenticated', 'authenticated'),
  ('e3000000-0000-4000-8000-000000000002', 'voice-reviewer@example.test', 'authenticated', 'authenticated');

insert into public.user_roles (user_id, role) values
  ('e3000000-0000-4000-8000-000000000001', 'editor'),
  ('e3000000-0000-4000-8000-000000000002', 'rights_reviewer');

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

insert into public.licenses (id, licensor, scope, allowed_platforms, commercial_allowed, territory)
values ('13000000-0000-4000-8000-000000000001', 'Acme TTS', 'Voz estándar, uso comercial',
        array['youtube']::public.platform[], true, 'Mundial');

select pg_temp.login('e3000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.voices (provider, provider_voice_id, display_name) values ('acme', 'v1', 'Lucía')$$,
  '42501', null,
  'editors cannot register voices'
);
select pg_temp.logout();

select pg_temp.login('e3000000-0000-4000-8000-000000000002');
insert into public.voices (id, provider, provider_voice_id, display_name)
values ('f3000000-0000-4000-8000-000000000001', 'acme', 'v1', 'Lucía');
select throws_ok(
  $$update public.voices set approved_at = now(), approved_by = 'e3000000-0000-4000-8000-000000000002'
    where id = 'f3000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a real voice cannot be approved without a license'
);
select lives_ok(
  $$update public.voices set license_id = '13000000-0000-4000-8000-000000000001',
    approved_at = now(), approved_by = 'e3000000-0000-4000-8000-000000000002'
    where id = 'f3000000-0000-4000-8000-000000000001'$$,
  'a licensed voice is approved'
);
select throws_ok(
  $$insert into public.voices (provider, provider_voice_id, display_name, license_id,
      imitates_real_person, approved_at, approved_by)
    values ('acme', 'clone-1', 'Clon', '13000000-0000-4000-8000-000000000001', true, now(),
      'e3000000-0000-4000-8000-000000000002')$$,
  '23514', null,
  'a voice imitating a real person cannot be approved without consent'
);
select lives_ok(
  $$update public.voices set locale = 'es-419' where id = 'f3000000-0000-4000-8000-000000000001'$$,
  'changing what was approved is allowed'
);
select is(
  (select approved_at from public.voices where id = 'f3000000-0000-4000-8000-000000000001'),
  null,
  'and it withdraws the approval'
);
select throws_ok(
  $$update public.voices set disclosure_required = false where id = 'f3000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'skipping the synthetic-voice disclosure needs a written reason'
);
select pg_temp.logout();

select * from finish();
rollback;
