-- Phase 4 (T29): gates for real platform uploads and reconciliation checkpoints (ADR 0005).
-- A real upload also needs PUBLISHING_MODE=live in the worker and an active credential; this
-- migration only adds the per-channel switch, the visibility and the checkpoint column.

create type public.upload_visibility as enum ('private', 'public');

alter table public.channels
  add column live_uploads_enabled boolean not null default false,
  add column live_uploads_reason  text check (char_length(live_uploads_reason) <= 500),
  add column upload_visibility    public.upload_visibility not null default 'private',
  -- Phase 4: nothing is ever made public (rule 1). Relaxing this is a Phase 6 decision.
  add constraint channels_public_uploads_disabled check (upload_visibility <> 'public'),
  -- The simulator has no real uploads to switch on.
  add constraint channels_live_uploads_real_platform
    check (not live_uploads_enabled or platform <> 'simulated'),
  -- Every switch-on carries the reason, so the audit log explains it.
  add constraint channels_live_uploads_reason_required
    check (not live_uploads_enabled or coalesce(char_length(trim(live_uploads_reason)), 0) >= 3);

comment on column public.channels.live_uploads_enabled is
  'Admin switch for real (private) uploads on this channel. Off by default.';
comment on column public.channels.upload_visibility is
  'Visibility of real uploads. Only private is allowed in Phase 4.';

alter table public.publications
  add column platform_checkpoint jsonb
    check (platform_checkpoint is null
           or (jsonb_typeof(platform_checkpoint) = 'object'
               and pg_column_size(platform_checkpoint) <= 2048));

comment on column public.publications.platform_checkpoint is
  'Ids saved by the adapter before an ambiguous step (upload session, publish id, container). '
  'Never tokens or signed URLs. Written by the worker only.';

-- Members can only insert publications (no update policy). Forbid forging a checkpoint on
-- insert, which would make the worker reconcile against an upload it never started.
create function public.guard_publication_checkpoint()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.platform_checkpoint is not null
     and coalesce((select auth.role()), '') in ('authenticated', 'anon') then
    raise exception 'platform_checkpoint is written by the worker only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger publications_guard_checkpoint
  before insert on public.publications
  for each row execute function public.guard_publication_checkpoint();
