begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email, aud, role) values
  ('e4000000-0000-4000-8000-000000000001', 'ref-author@example.test', 'authenticated', 'authenticated'),
  ('e4000000-0000-4000-8000-000000000002', 'ref-reviewer@example.test', 'authenticated', 'authenticated');

insert into public.opportunities (id, topic) values ('0b400000-0000-4000-8000-000000000001', 'Refs');
insert into public.claims (id, opportunity_id, text, certainty, created_by)
values ('c4000000-0000-4000-8000-000000000001', '0b400000-0000-4000-8000-000000000001',
        'Un rumor', 'rumor', 'e4000000-0000-4000-8000-000000000001');
insert into public.assets (id, kind, origin, title, owner, storage_path, content_hash, mime_type,
                           size_bytes)
values ('a4000000-0000-4000-8000-000000000001', 'image', 'original_work', 'Propio', 'Equipo',
        'assets/ref.png', repeat('e', 64), 'image/png', 1);
update public.assets set rights_status = 'original', reviewed_by = 'e4000000-0000-4000-8000-000000000002'
 where id = 'a4000000-0000-4000-8000-000000000001';

delete from auth.users where id = 'e4000000-0000-4000-8000-000000000001';
select is(
  (select created_by from public.claims where id = 'c4000000-0000-4000-8000-000000000001'),
  null,
  'deleting an author clears created_by instead of leaving a dangling id'
);
select is(
  (select count(*)::int from public.claims where created_by is not null
     and not exists (select 1 from auth.users u where u.id = created_by)),
  0,
  'no claim points to a deleted user'
);
select throws_ok(
  $$delete from auth.users where id = 'e4000000-0000-4000-8000-000000000002'$$,
  '23503', null,
  'a rights reviewer with decisions on record cannot be deleted'
);

select * from finish();
rollback;
