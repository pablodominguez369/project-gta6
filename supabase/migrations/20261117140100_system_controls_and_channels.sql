-- Emergency controls (global pause, spend limits) and publishing channels.

create table public.system_controls (
  id                      boolean primary key default true check (id),
  global_paused           boolean not null default false,
  paused_reason           text check (char_length(paused_reason) <= 500),
  daily_spend_limit_eur   numeric(10, 2) not null default 0 check (daily_spend_limit_eur >= 0),
  monthly_spend_limit_eur numeric(10, 2) not null default 0 check (monthly_spend_limit_eur >= 0),
  updated_by              uuid references auth.users (id) on delete set null,
  updated_at              timestamptz not null default now()
);

comment on table public.system_controls is
  'Singleton row. Spend limits default to 0 (nothing allowed) and are only changed by an admin.';

insert into public.system_controls (id) values (true);

alter table public.system_controls enable row level security;
revoke all on table public.system_controls from anon;

create trigger system_controls_set_updated_at
  before update on public.system_controls
  for each row execute function public.set_updated_at();

create policy "system_controls: members read"
  on public.system_controls for select
  to authenticated
  using ((select public.is_member()));

create policy "system_controls: admins update"
  on public.system_controls for update
  to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));
-- No insert/delete policies: the singleton row can only be changed, never removed.

create type public.platform as enum ('youtube', 'instagram', 'tiktok', 'simulated');
create type public.channel_mode as enum ('draft', 'approval', 'autopublish', 'manual');

create table public.channels (
  id                        uuid primary key default gen_random_uuid(),
  platform                  public.platform not null,
  display_name              text not null check (char_length(display_name) between 1 and 100),
  mode                      public.channel_mode not null default 'draft',
  paused                    boolean not null default false,
  paused_reason             text check (char_length(paused_reason) <= 500),
  timezone                  text not null default 'Europe/Madrid',
  max_posts_per_day         integer not null default 1 check (max_posts_per_day between 0 and 50),
  min_minutes_between_posts integer not null default 120 check (min_minutes_between_posts >= 0),
  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- Phase 1: autopublish is not available for any channel (spec section 2, rule 1).
  constraint channels_autopublish_disabled check (mode <> 'autopublish')
);

comment on column public.channels.timezone is 'IANA time zone used for scheduling windows.';

alter table public.channels enable row level security;
revoke all on table public.channels from anon;

create function public.validate_channel_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid IANA time zone: %', new.timezone
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger channels_validate_timezone
  before insert or update of timezone on public.channels
  for each row execute function public.validate_channel_timezone();

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

create policy "channels: members read"
  on public.channels for select
  to authenticated
  using ((select public.is_member()));

create policy "channels: admins create"
  on public.channels for insert
  to authenticated
  with check ((select public.has_role('admin')));

create policy "channels: admins update"
  on public.channels for update
  to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

create policy "channels: admins delete"
  on public.channels for delete
  to authenticated
  using ((select public.has_role('admin')));
