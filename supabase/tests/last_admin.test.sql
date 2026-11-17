begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'only-admin@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'second-admin@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin');

select throws_ok(
  $$delete from public.user_roles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'admin'$$,
  '23514',
  'cannot remove the last admin',
  'the last admin role cannot be removed'
);

select throws_ok(
  $$delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514',
  'cannot remove the last admin',
  'the last admin user cannot be deleted'
);

insert into public.user_roles (user_id, role) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin');
select lives_ok(
  $$delete from public.user_roles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'admin'$$,
  'an admin can be removed while another admin remains'
);

select * from finish();
rollback;
