-- Media projects and renders (Phase 3, T23). An editor turns an approved script into a video
-- project (voice, backgrounds per scene, music, target platforms) and queues it; the render
-- worker does the rest. Renders are written only by the worker.

create type public.media_project_status as enum (
  'draft', 'queued', 'rendering', 'rendered', 'blocked', 'failed'
);

create table public.media_projects (
  id               uuid primary key default gen_random_uuid(),
  script_id        uuid not null references public.scripts (id) on delete restrict,
  template         text not null default 'vertical-news-v1' check (template in ('vertical-news-v1')),
  voice_id         uuid references public.voices (id) on delete restrict,
  music_asset_id   uuid references public.assets (id) on delete restrict,
  target_platforms public.platform[] not null default array['youtube']::public.platform[]
                   check (cardinality(target_platforms) between 1 and 4),
  -- Own brand shown on the video. Never another platform's watermark.
  brand            text not null default '' check (char_length(brand) <= 60),
  status           public.media_project_status not null default 'draft',
  status_reason    text check (char_length(status_reason) <= 1000),
  attempts         integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at  timestamptz,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index media_projects_status_idx on public.media_projects (status, next_attempt_at);
create index media_projects_script_idx on public.media_projects (script_id);

alter table public.media_projects enable row level security;
revoke all on table public.media_projects from anon;
revoke delete, truncate on table public.media_projects from authenticated;

create trigger media_projects_keep_created_by
  before update on public.media_projects
  for each row execute function public.keep_created_by();

create trigger media_projects_set_updated_at
  before update on public.media_projects
  for each row execute function public.set_updated_at();

-- Clients edit drafts and queue them; every other transition belongs to the worker.
create function public.guard_media_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'new projects start as draft' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.scripts where id = new.script_id and status = 'approved') then
      raise exception 'only approved scripts become videos' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status in ('queued', 'rendering') then
    raise exception 'the project is being rendered' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and new.status not in ('draft', 'queued') then
    raise exception 'only the worker sets render results' using errcode = 'insufficient_privilege';
  end if;
  if new.status = 'queued' and old.status <> 'queued' then
    new.attempts := 0;
    new.next_attempt_at := null;
    new.status_reason := null;
  end if;
  if (new.attempts, new.next_attempt_at, new.status_reason)
     is distinct from (old.attempts, old.next_attempt_at, old.status_reason)
     and new.status <> 'queued' then
    raise exception 'only the worker sets render results' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger media_projects_guard
  before insert or update on public.media_projects
  for each row execute function public.guard_media_project();

create trigger media_projects_audit
  after insert or update on public.media_projects
  for each row execute function public.audit_row_change();

create policy "media_projects: members read"
  on public.media_projects for select to authenticated
  using ((select public.is_member()));

create policy "media_projects: editors create"
  on public.media_projects for insert to authenticated
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and created_by = (select auth.uid())
  );

create policy "media_projects: editors update"
  on public.media_projects for update to authenticated
  using ((select public.has_any_role(array['admin', 'editor']::public.app_role[])))
  with check ((select public.has_any_role(array['admin', 'editor']::public.app_role[])));

-- Background asset per scene (0-based script line index).
create table public.media_project_scenes (
  project_id  uuid not null references public.media_projects (id) on delete cascade,
  scene_index integer not null check (scene_index between 0 and 19),
  asset_id    uuid not null references public.assets (id) on delete restrict,
  primary key (project_id, scene_index)
);

create index media_project_scenes_asset_idx on public.media_project_scenes (asset_id);

alter table public.media_project_scenes enable row level security;
revoke all on table public.media_project_scenes from anon;

create function public.media_project_is_editable(p_project_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.media_projects
     where id = p_project_id and status not in ('queued', 'rendering')
  );
$$;

create policy "media_project_scenes: members read"
  on public.media_project_scenes for select to authenticated
  using ((select public.is_member()));

create policy "media_project_scenes: editors set"
  on public.media_project_scenes for insert to authenticated
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and public.media_project_is_editable(project_id)
  );

create policy "media_project_scenes: editors change"
  on public.media_project_scenes for update to authenticated
  using (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and public.media_project_is_editable(project_id)
  )
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and public.media_project_is_editable(project_id)
  );

create policy "media_project_scenes: editors remove"
  on public.media_project_scenes for delete to authenticated
  using (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and public.media_project_is_editable(project_id)
  );

create table public.renders (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.media_projects (id) on delete restrict,
  version             integer not null check (version >= 1),
  -- master: clean 1080x1920 file; other values are per-platform encodes of the same master.
  profile             text not null check (profile in ('master', 'youtube', 'instagram', 'tiktok')),
  storage_path        text not null unique check (storage_path ~ '^renders/'),
  checksum            text not null check (checksum ~ '^[0-9a-f]{64}$'),
  size_bytes          bigint not null check (size_bytes > 0),
  duration_ms         integer not null check (duration_ms > 0),
  width               integer not null,
  height              integer not null,
  video_codec         text not null,
  audio_codec         text,
  qc_passed           boolean not null,
  qc_report           jsonb not null check (jsonb_typeof(qc_report) = 'object'),
  -- Reproducibility: source hashes, voice, template, FFmpeg version and parameters.
  manifest            jsonb not null check (jsonb_typeof(manifest) = 'object'),
  manifest_path       text not null check (manifest_path ~ '^renders/'),
  disclosure_required boolean not null,
  created_at          timestamptz not null default now(),
  unique (project_id, version, profile)
);

create index renders_project_idx on public.renders (project_id, version desc);

alter table public.renders enable row level security;
revoke all on table public.renders from anon;
revoke insert, update, delete, truncate on table public.renders from authenticated;

create policy "renders: members read"
  on public.renders for select to authenticated
  using ((select public.is_member()));
-- No client write policies: renders are written by the worker with the secret key.

create trigger renders_audit
  after insert on public.renders
  for each row execute function public.audit_row_change();
