-- Fix (Phase 3, T22): deleting a user left dangling `created_by` / `reviewed_by` ids.
-- `on delete set null` runs as an UPDATE, and the `keep_created_by` and `guard_asset_rights`
-- triggers put the old id back, so the row kept pointing to a user that no longer exists.

-- Authorship still cannot be re-assigned, but it can be cleared when the user is gone.
create or replace function public.keep_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null
     and old.created_by is not null
     and not exists (select 1 from auth.users where id = old.created_by) then
    return new;
  end if;
  new.created_by := old.created_by;
  return new;
end;
$$;

revoke execute on function public.keep_created_by() from public, anon, authenticated;

-- Rights decisions keep their reviewer for the audit trail, like approvals: a reviewer who
-- cleared an asset cannot be deleted (remove their roles instead).
update public.assets a
   set rights_status = 'unknown', reviewed_by = null, reviewed_at = null,
       rights_note = 'Revisión anulada: el revisor ya no existe.'
 where a.reviewed_by is not null
   and not exists (select 1 from auth.users u where u.id = a.reviewed_by);

alter table public.assets drop constraint assets_reviewed_by_fkey;
alter table public.assets
  add constraint assets_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users (id) on delete restrict;

-- Clear authorship that already points to deleted users (only possible in local databases).
update public.claims c set created_by = null
 where c.created_by is not null and not exists (select 1 from auth.users u where u.id = c.created_by);
update public.scripts s set created_by = null
 where s.created_by is not null and not exists (select 1 from auth.users u where u.id = s.created_by);
update public.licenses l set created_by = null
 where l.created_by is not null and not exists (select 1 from auth.users u where u.id = l.created_by);
update public.assets a set created_by = null
 where a.created_by is not null and not exists (select 1 from auth.users u where u.id = a.created_by);
