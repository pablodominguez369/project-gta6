-- Human approvals (Phase 2, T11). Append-only. A reviewer can never approve their own work.

create type public.approval_decision as enum ('approved', 'changes_requested', 'rejected');

create table public.approvals (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('script')),
  target_id   uuid not null,
  reviewer_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  decision    public.approval_decision not null,
  reason      text check (char_length(reason) <= 2000),
  created_at  timestamptz not null default now(),
  constraint approvals_non_approval_has_reason
    check (decision = 'approved' or char_length(coalesce(reason, '')) >= 3)
);

create index approvals_target_idx on public.approvals (target_type, target_id);

alter table public.approvals enable row level security;
revoke all on table public.approvals from anon;
revoke update, delete, truncate on table public.approvals from authenticated;

create policy "approvals: members read"
  on public.approvals for select to authenticated
  using ((select public.is_member()));

create policy "approvals: editors and admins review"
  on public.approvals for insert to authenticated
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and reviewer_id = (select auth.uid())
  );

-- Validates the review and applies its decision to the script, atomically.
create function public.apply_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  script record;
begin
  select id, status, created_by into script
    from public.scripts where id = new.target_id for update;
  if not found then
    raise exception 'script % not found', new.target_id using errcode = 'foreign_key_violation';
  end if;
  if script.status <> 'in_review' then
    raise exception 'only scripts in review can be decided' using errcode = 'check_violation';
  end if;
  if script.created_by is not distinct from new.reviewer_id then
    raise exception 'authors cannot review their own script' using errcode = 'check_violation';
  end if;

  update public.scripts
     set status = new.decision::text::public.script_status
   where id = new.target_id;
  return new;
end;
$$;

revoke execute on function public.apply_approval() from public, anon, authenticated;

create trigger approvals_apply
  before insert on public.approvals
  for each row execute function public.apply_approval();

create function public.reject_approval_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'approvals are append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger approvals_no_update
  before update or delete on public.approvals
  for each row execute function public.reject_approval_mutation();

create trigger approvals_audit
  after insert on public.approvals
  for each row execute function public.audit_row_change();
