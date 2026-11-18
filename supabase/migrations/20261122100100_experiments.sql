-- Phase 5 (T36): single-variable experiments with a control arm (ADR 0006).
-- A result is computed by the panel from metric_snapshots; nothing is changed automatically.

create type public.experiment_variable as enum ('hook', 'duration', 'time_slot', 'topic');
create type public.experiment_status as enum ('draft', 'running', 'finished', 'cancelled');
create type public.experiment_arm as enum ('control', 'variant');

create table public.experiments (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(trim(name)) between 3 and 120),
  hypothesis          text not null check (char_length(trim(hypothesis)) between 10 and 1000),
  variable            public.experiment_variable not null,
  -- One platform per experiment: metrics of different platforms are never compared.
  platform            public.platform not null,
  control_label       text not null check (char_length(trim(control_label)) between 1 and 120),
  variant_label       text not null check (char_length(trim(variant_label)) between 1 and 120),
  time_window         public.metric_window not null default '7d',
  min_sample_per_arm  integer not null default 10 check (min_sample_per_arm between 5 and 1000),
  status              public.experiment_status not null default 'draft',
  starts_at           timestamptz,
  ends_at             timestamptz,
  result_summary      jsonb check (result_summary is null or jsonb_typeof(result_summary) = 'object'),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (status <> 'running' or starts_at is not null)
);

comment on table public.experiments is
  'One variable, a control and a variant, one platform. A winner needs the minimum sample in '
  'both arms and an interval that excludes no difference (packages/domain analytics).';

create table public.experiment_publications (
  experiment_id  uuid not null references public.experiments (id) on delete cascade,
  publication_id uuid not null references public.publications (id) on delete cascade,
  arm            public.experiment_arm not null,
  assigned_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (experiment_id, publication_id)
);

create index experiment_publications_publication_idx
  on public.experiment_publications (publication_id);

alter table public.experiments enable row level security;
alter table public.experiment_publications enable row level security;
revoke all on table public.experiments from anon;
revoke all on table public.experiment_publications from anon;

create trigger experiments_set_updated_at
  before update on public.experiments
  for each row execute function public.set_updated_at();

-- A publication joins an experiment only if it belongs to the experiment's platform.
create function public.experiment_publications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.experiments e
      join public.publications p on p.id = new.publication_id
      join public.channels c on c.id = p.channel_id
     where e.id = new.experiment_id and c.platform = e.platform
  ) then
    raise exception 'the publication is not on the experiment''s platform'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger experiment_publications_guard
  before insert or update on public.experiment_publications
  for each row execute function public.experiment_publications_guard();

create policy "experiments: members read"
  on public.experiments for select to authenticated
  using ((select public.is_member()));
create policy "experiments: admins and analysts insert"
  on public.experiments for insert to authenticated
  with check ((select public.has_any_role(array['admin', 'analyst']::public.app_role[])));
create policy "experiments: admins and analysts update"
  on public.experiments for update to authenticated
  using ((select public.has_any_role(array['admin', 'analyst']::public.app_role[])))
  with check ((select public.has_any_role(array['admin', 'analyst']::public.app_role[])));
create policy "experiments: admins delete"
  on public.experiments for delete to authenticated
  using ((select public.has_role('admin')));

create policy "experiment_publications: members read"
  on public.experiment_publications for select to authenticated
  using ((select public.is_member()));
create policy "experiment_publications: admins and analysts insert"
  on public.experiment_publications for insert to authenticated
  with check ((select public.has_any_role(array['admin', 'analyst']::public.app_role[])));
create policy "experiment_publications: admins and analysts delete"
  on public.experiment_publications for delete to authenticated
  using ((select public.has_any_role(array['admin', 'analyst']::public.app_role[])));

create trigger experiments_audit
  after insert or update or delete on public.experiments
  for each row execute function public.audit_row_change();
create trigger experiment_publications_audit
  after insert or update or delete on public.experiment_publications
  for each row execute function public.audit_row_change();
