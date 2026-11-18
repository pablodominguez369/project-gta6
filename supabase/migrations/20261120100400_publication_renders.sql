-- Publications point to the render they publish (Phase 3, T26). The worker re-checks the render's
-- QC, the current rights of every asset in its manifest and its voice before EVERY publish
-- attempt; this migration only links the rows and refuses renders that failed QC up front.

alter table public.publications
  add column render_id uuid references public.renders (id) on delete restrict;

create index publications_render_idx on public.publications (render_id);

comment on column public.publications.render_id is
  'Render being published. Required for real platforms (checked by the worker); the simulator may run without one.';

create function public.guard_publication_render()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.render_id is not distinct from old.render_id then
      return new;
    end if;
    if old.status <> 'queued' then
      raise exception 'the video of a publication in progress cannot change'
        using errcode = '23514';
    end if;
  end if;
  if new.render_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.renders r
     where r.id = new.render_id and r.qc_passed and r.profile = 'master'
  ) then
    raise exception 'only renders that passed QC can be published'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger publications_guard_render
  before insert or update of render_id on public.publications
  for each row execute function public.guard_publication_render();
