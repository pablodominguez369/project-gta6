-- Append-only audit log plus automatic auditing of configuration tables.

create table public.audit_events (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid,
  actor_type   text not null check (actor_type in ('user', 'system', 'worker')),
  action       text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  object_type  text not null check (char_length(object_type) between 1 and 100),
  object_id    text,
  request_id   text,
  safe_details jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only. UPDATE, DELETE and TRUNCATE are rejected for every role, including service_role.';
comment on column public.audit_events.safe_details is
  'Sanitized context only (see packages/observability redact). Never tokens, signed URLs or prompts.';

create index audit_events_created_at_idx on public.audit_events (created_at desc);
create index audit_events_object_idx on public.audit_events (object_type, object_id);

alter table public.audit_events enable row level security;
revoke all on table public.audit_events from anon;
revoke update, delete, truncate on table public.audit_events from authenticated, service_role;

create function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_no_update
  before update or delete on public.audit_events
  for each row execute function public.reject_audit_mutation();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function public.reject_audit_mutation();

create policy "audit_events: admins read"
  on public.audit_events for select
  to authenticated
  using ((select public.has_role('admin')));
-- No insert policy for clients: rows come from the trigger below or from server code
-- using the service role.

-- Generic change auditing. Records which columns changed and the new values of
-- non-sensitive columns. Runs as definer so it can insert regardless of the caller's RLS.
create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  excluded_columns constant text[] := array['secret_ref', 'updated_at', 'created_at'];
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  changed text[];
  new_values jsonb;
  object_id text;
  actor uuid := (select auth.uid());
begin
  select coalesce(array_agg(key order by key), '{}')
    into changed
    from jsonb_object_keys(old_row || new_row) as key
   where not (key = any (excluded_columns))
     and (old_row -> key) is distinct from (new_row -> key);

  if tg_op = 'UPDATE' and cardinality(changed) = 0 then
    return new;
  end if;

  select coalesce(jsonb_object_agg(key, new_row -> key), '{}'::jsonb)
    into new_values
    from unnest(changed) as key
   where tg_op <> 'DELETE';

  object_id := coalesce(new_row ->> 'id', old_row ->> 'id', new_row ->> 'user_id', old_row ->> 'user_id');

  insert into public.audit_events (actor_id, actor_type, action, object_type, object_id, safe_details)
  values (
    actor,
    case when actor is null then 'system' else 'user' end,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    object_id,
    jsonb_build_object('changed_columns', to_jsonb(changed), 'new_values', new_values)
  );

  return coalesce(new, old);
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

create trigger user_roles_audit
  after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change();

create trigger system_controls_audit
  after insert or update or delete on public.system_controls
  for each row execute function public.audit_row_change();

create trigger channels_audit
  after insert or update or delete on public.channels
  for each row execute function public.audit_row_change();

create trigger credential_refs_audit
  after insert or update or delete on public.credential_refs
  for each row execute function public.audit_row_change();

create trigger publications_audit
  after insert or update or delete on public.publications
  for each row execute function public.audit_row_change();
