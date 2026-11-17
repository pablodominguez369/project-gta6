-- Never leave the platform without an admin: removing the last admin role (directly or by
-- deleting the user) is rejected.

create function public.prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and not exists (
    select 1 from public.user_roles
     where role = 'admin' and user_id <> old.user_id
  ) then
    raise exception 'cannot remove the last admin'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

revoke execute on function public.prevent_last_admin_removal() from public, anon, authenticated;

create trigger user_roles_protect_last_admin
  before delete on public.user_roles
  for each row execute function public.prevent_last_admin_removal();
