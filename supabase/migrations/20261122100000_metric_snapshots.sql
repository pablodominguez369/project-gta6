-- Phase 5 (T36): metric snapshots per publication and fixed window (ADR 0006).
-- One row per publication and window. Unknown metrics stay null: null is not zero.
-- Clients only read; the worker writes through its direct connection and people record
-- manual numbers through record_manual_metrics().

create type public.metric_window as enum ('1h', '24h', '7d', '28d');
create type public.metric_source as enum ('platform_api', 'manual', 'simulated');

create table public.metric_snapshots (
  id                     uuid primary key default gen_random_uuid(),
  publication_id         uuid not null references public.publications (id) on delete cascade,
  -- Copied from the publication's channel by a trigger; never trusted from the caller.
  platform               public.platform not null,
  time_window            public.metric_window not null,
  source                 public.metric_source not null,
  captured_at            timestamptz not null default now(),
  views                  bigint check (views >= 0),
  reach                  bigint check (reach >= 0),
  impressions            bigint check (impressions >= 0),
  likes                  bigint check (likes >= 0),
  comments               bigint check (comments >= 0),
  shares                 bigint check (shares >= 0),
  saves                  bigint check (saves >= 0),
  watch_time_seconds     bigint check (watch_time_seconds >= 0),
  avg_watch_time_seconds numeric(12, 3) check (avg_watch_time_seconds >= 0),
  avg_view_percentage    numeric(7, 3) check (avg_view_percentage >= 0),
  followers_delta        integer,
  -- The platform's own names for the values above, e.g. {viewCount, likeCount}.
  raw_metric_names       text[] not null default '{}'
                         check (cardinality(raw_metric_names) <= 32),
  -- Bumped when a platform changes a metric definition, so old and new numbers are not mixed.
  definition_version     smallint not null default 1 check (definition_version >= 1),
  entered_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (publication_id, time_window)
);

comment on table public.metric_snapshots is
  'Platform-native metrics per publication and window (1h, 24h, 7d, 28d after published_at). '
  'Never add up or rank numbers from different platforms.';
comment on column public.metric_snapshots.views is
  'Null = the platform did not report it. Definitions differ per platform (docs/platforms.md).';

create index metric_snapshots_platform_window_idx
  on public.metric_snapshots (platform, time_window, captured_at desc);

alter table public.metric_snapshots enable row level security;
revoke all on table public.metric_snapshots from anon;
revoke insert, update, delete on table public.metric_snapshots from authenticated;

create policy "metric_snapshots: members read"
  on public.metric_snapshots for select to authenticated
  using ((select public.is_member()));

create function public.metric_snapshots_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  publication_platform public.platform;
begin
  select c.platform into publication_platform
    from public.publications p join public.channels c on c.id = p.channel_id
   where p.id = new.publication_id;
  if publication_platform is null then
    raise exception 'unknown publication' using errcode = 'foreign_key_violation';
  end if;
  new.platform := publication_platform;

  -- A number a person typed is never overwritten by an automatic read.
  if tg_op = 'UPDATE' and old.source = 'manual' and new.source <> 'manual' then
    raise exception 'a manual snapshot is not overwritten automatically'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger metric_snapshots_guard
  before insert or update on public.metric_snapshots
  for each row execute function public.metric_snapshots_guard();

create trigger metric_snapshots_set_updated_at
  before update on public.metric_snapshots
  for each row execute function public.set_updated_at();

-- Interval each window stands for, after published_at.
create function public.metric_window_interval(w public.metric_window)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case w
    when '1h' then interval '1 hour'
    when '24h' then interval '24 hours'
    when '7d' then interval '7 days'
    when '28d' then interval '28 days'
  end;
$$;

-- Manual entry (Instagram, or any platform whose numbers cannot be read through the API).
-- metrics: {"views": 120, "likes": 4, ...}; only the known keys, non-negative integers or null.
create function public.record_manual_metrics(
  publication_id uuid,
  time_window public.metric_window,
  metrics jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  allowed constant text[] := array[
    'views', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves',
    'watch_time_seconds', 'avg_watch_time_seconds', 'avg_view_percentage', 'followers_delta'
  ];
  key text;
  value jsonb;
  provided text[] := '{}';
  published timestamptz;
  snapshot_id uuid;
begin
  if actor is null
     or not public.has_any_role(array['admin', 'publisher', 'analyst']::public.app_role[]) then
    raise exception 'only admins, publishers and analysts record metrics'
      using errcode = 'insufficient_privilege';
  end if;
  if metrics is null or jsonb_typeof(metrics) <> 'object' then
    raise exception 'metrics must be an object' using errcode = 'check_violation';
  end if;
  for key, value in select * from jsonb_each(metrics) loop
    if not (key = any (allowed)) then
      raise exception 'unknown metric %', key using errcode = 'check_violation';
    end if;
    if jsonb_typeof(value) = 'null' then
      continue;
    end if;
    if jsonb_typeof(value) <> 'number'
       or (key <> 'followers_delta' and (value #>> '{}')::numeric < 0)
       or (key not in ('avg_watch_time_seconds', 'avg_view_percentage')
           and (value #>> '{}')::numeric <> trunc((value #>> '{}')::numeric)) then
      raise exception 'metric % must be a non-negative number', key using errcode = 'check_violation';
    end if;
    provided := provided || key;
  end loop;
  provided := array(select unnest(provided) order by 1);
  if cardinality(provided) = 0 then
    raise exception 'at least one metric is required' using errcode = 'check_violation';
  end if;

  select p.published_at into published
    from public.publications p
   where p.id = record_manual_metrics.publication_id and p.status = 'succeeded';
  if published is null then
    raise exception 'publication is not published' using errcode = 'P0002';
  end if;
  if published + public.metric_window_interval(record_manual_metrics.time_window) > now() then
    raise exception 'that window has not ended yet' using errcode = 'check_violation';
  end if;

  insert into public.metric_snapshots as m (
    publication_id, platform, time_window, source, captured_at, views, reach, impressions,
    likes, comments, shares, saves, watch_time_seconds, avg_watch_time_seconds,
    avg_view_percentage, followers_delta, raw_metric_names, entered_by
  )
  values (
    record_manual_metrics.publication_id,
    'simulated', -- replaced by the guard trigger with the channel's platform
    record_manual_metrics.time_window,
    'manual',
    now(),
    (metrics ->> 'views')::bigint,
    (metrics ->> 'reach')::bigint,
    (metrics ->> 'impressions')::bigint,
    (metrics ->> 'likes')::bigint,
    (metrics ->> 'comments')::bigint,
    (metrics ->> 'shares')::bigint,
    (metrics ->> 'saves')::bigint,
    (metrics ->> 'watch_time_seconds')::bigint,
    (metrics ->> 'avg_watch_time_seconds')::numeric,
    (metrics ->> 'avg_view_percentage')::numeric,
    (metrics ->> 'followers_delta')::integer,
    provided,
    actor
  )
  on conflict on constraint metric_snapshots_publication_id_time_window_key do update
    set source = 'manual',
        captured_at = excluded.captured_at,
        views = excluded.views,
        reach = excluded.reach,
        impressions = excluded.impressions,
        likes = excluded.likes,
        comments = excluded.comments,
        shares = excluded.shares,
        saves = excluded.saves,
        watch_time_seconds = excluded.watch_time_seconds,
        avg_watch_time_seconds = excluded.avg_watch_time_seconds,
        avg_view_percentage = excluded.avg_view_percentage,
        followers_delta = excluded.followers_delta,
        raw_metric_names = excluded.raw_metric_names,
        entered_by = excluded.entered_by
  returning m.id into snapshot_id;

  insert into public.audit_events (actor_id, actor_type, action, object_type, object_id, safe_details)
  values (actor, 'user', 'metrics.manual_recorded', 'publications',
          record_manual_metrics.publication_id::text,
          jsonb_build_object('window', record_manual_metrics.time_window, 'metrics', to_jsonb(provided)));
  return snapshot_id;
end;
$$;

revoke execute on function public.record_manual_metrics(uuid, public.metric_window, jsonb) from public, anon;
grant execute on function public.record_manual_metrics(uuid, public.metric_window, jsonb) to authenticated;
