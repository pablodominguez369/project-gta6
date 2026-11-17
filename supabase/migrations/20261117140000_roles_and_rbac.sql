-- Roles and RBAC helpers.
-- Every later policy uses public.has_role / public.has_any_role.

create type public.app_role as enum (
  'admin',
  'editor',
  'rights_reviewer',
  'publisher',
  'analyst',
  'read_only'
);

create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

comment on table public.user_roles is 'RBAC role assignments. Writable by admins only.';

alter table public.user_roles enable row level security;
revoke all on table public.user_roles from anon;

-- security definer so policies on user_roles itself do not recurse.
create function public.has_role(required public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = required
  );
$$;

create function public.has_any_role(required public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = any (required)
  );
$$;

-- True for any user holding at least one role (i.e. a member of the private platform).
create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur where ur.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.has_role(public.app_role) from public, anon;
revoke execute on function public.has_any_role(public.app_role[]) from public, anon;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated, service_role;
grant execute on function public.has_any_role(public.app_role[]) to authenticated, service_role;
grant execute on function public.is_member() to authenticated, service_role;

create policy "user_roles: members read own roles, admins read all"
  on public.user_roles for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));

create policy "user_roles: admins grant roles"
  on public.user_roles for insert
  to authenticated
  with check ((select public.has_role('admin')));

create policy "user_roles: admins revoke roles"
  on public.user_roles for delete
  to authenticated
  using ((select public.has_role('admin')));

-- Shared trigger function to maintain updated_at columns.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
