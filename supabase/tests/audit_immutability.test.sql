begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

update public.channels set paused = true, paused_reason = 'audit test'
 where id = '00000000-0000-4000-8000-000000000001';

select ok(
  (select safe_details -> 'changed_columns' ? 'paused'
     from public.audit_events
    where action = 'channels.update'
    order by created_at desc limit 1),
  'channel update is audited with its changed columns'
);

select is(
  (select actor_type from public.audit_events where action = 'channels.update' order by created_at desc limit 1),
  'system',
  'changes without a user session are attributed to system'
);

-- Mutations are rejected for every role, including the table owner.
select throws_ok(
  $$update public.audit_events set action = 'tampered.event'$$,
  '42501',
  'audit_events is append-only',
  'postgres cannot update audit events'
);
select throws_ok(
  $$delete from public.audit_events$$,
  '42501',
  'audit_events is append-only',
  'postgres cannot delete audit events'
);
select throws_ok(
  $$truncate public.audit_events$$,
  '42501',
  'audit_events is append-only',
  'postgres cannot truncate audit events'
);

set local role service_role;
select throws_ok(
  $$delete from public.audit_events$$,
  '42501',
  null,
  'service_role cannot delete audit events'
);

select * from finish();
rollback;
