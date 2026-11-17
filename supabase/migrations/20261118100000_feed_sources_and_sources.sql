-- Editorial research (Phase 2, T11): allowlisted feeds and normalized sources.
-- Only allowed sources: feeds whose terms were reviewed, or URLs added by an editor.
-- We keep metadata, a short excerpt and a hash; never the full third-party article.

-- Authorship is set once. Editors may update rows, but never re-assign who wrote them (that
-- would let an author approve or verify their own work).
create function public.keep_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := old.created_by;
  return new;
end;
$$;

create type public.feed_kind as enum ('rss', 'atom');
create type public.source_type as enum ('official', 'press', 'community', 'social');

create table public.feed_sources (
  id                   uuid primary key default gen_random_uuid(),
  url                  text not null unique check (url ~ '^https://'),
  publisher            text not null check (char_length(publisher) between 1 and 200),
  kind                 public.feed_kind not null,
  source_type          public.source_type not null,
  trust_level          smallint not null default 1 check (trust_level between 0 and 3),
  terms_url            text check (terms_url ~ '^https?://'),
  terms_checked_at     timestamptz,
  enabled              boolean not null default false,
  poll_minutes         integer not null default 60 check (poll_minutes between 15 and 1440),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_polled_at       timestamptz,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- A feed is only polled after someone recorded that its terms allow automated use.
  constraint feed_sources_enabled_requires_terms
    check (not enabled or (terms_url is not null and terms_checked_at is not null))
);

comment on column public.feed_sources.trust_level is
  '0 = unknown, 1 = community, 2 = established press, 3 = official/primary.';

alter table public.feed_sources enable row level security;
revoke all on table public.feed_sources from anon;

create trigger feed_sources_set_updated_at
  before update on public.feed_sources
  for each row execute function public.set_updated_at();

create policy "feed_sources: members read"
  on public.feed_sources for select to authenticated
  using ((select public.is_member()));

create policy "feed_sources: admins insert"
  on public.feed_sources for insert to authenticated
  with check ((select public.has_role('admin')));

create policy "feed_sources: admins update"
  on public.feed_sources for update to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

create policy "feed_sources: admins delete"
  on public.feed_sources for delete to authenticated
  using ((select public.has_role('admin')));

create table public.sources (
  id             uuid primary key default gen_random_uuid(),
  feed_source_id uuid references public.feed_sources (id) on delete set null,
  url            text not null check (url ~ '^https?://'),
  canonical_url  text not null unique check (canonical_url ~ '^https?://'),
  publisher      text not null check (char_length(publisher) between 1 and 200),
  title          text not null check (char_length(title) between 1 and 500),
  published_at   timestamptz,
  observed_at    timestamptz not null default now(),
  source_type    public.source_type not null,
  trust_level    smallint not null default 0 check (trust_level between 0 and 3),
  excerpt        text check (char_length(excerpt) <= 300),
  content_hash   text check (content_hash ~ '^[0-9a-f]{64}$'),
  added_by       uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on column public.sources.excerpt is
  'At most 300 characters, for context and attribution. Never the full article.';

create index sources_observed_at_idx on public.sources (observed_at desc);

alter table public.sources enable row level security;
revoke all on table public.sources from anon;

create policy "sources: members read"
  on public.sources for select to authenticated
  using ((select public.is_member()));

create policy "sources: editors add manually"
  on public.sources for insert to authenticated
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and feed_source_id is null
    and added_by = (select auth.uid())
  );
-- No update/delete for clients: sources are evidence and stay as observed.

create trigger feed_sources_audit
  after insert or update or delete on public.feed_sources
  for each row execute function public.audit_row_change();
