-- Structured scripts and LLM usage metering (Phase 2, T11).

create table public.llm_usage (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (char_length(provider) between 1 and 50),
  model         text not null check (char_length(model) between 1 and 100),
  purpose       text not null check (purpose ~ '^[a-z_]+(\.[a-z_]+)*$'),
  input_tokens  integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_eur      numeric(10, 4) not null check (cost_eur >= 0),
  request_id    text,
  created_at    timestamptz not null default now()
);

comment on table public.llm_usage is
  'One row per LLM call, used for the spend gate. Never stores prompts or outputs.';

create index llm_usage_created_at_idx on public.llm_usage (created_at desc);

alter table public.llm_usage enable row level security;
revoke all on table public.llm_usage from anon;

create policy "llm_usage: admins and analysts read"
  on public.llm_usage for select to authenticated
  using ((select public.has_any_role(array['admin', 'analyst']::public.app_role[])));
-- No write policies: only the worker records usage.

create type public.script_status as enum (
  'draft', 'in_review', 'changes_requested', 'approved', 'rejected'
);

create table public.scripts (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid not null references public.opportunities (id) on delete restrict,
  version           integer not null default 1 check (version >= 1),
  locale            text not null default 'es-ES' check (locale in ('es-ES', 'es-419')),
  target_duration_s integer not null default 45 check (target_duration_s between 20 and 60),
  -- [{ "kind": "hook|context|body|cta", "voice": "...", "on_screen": "...", "claim_refs": [uuid],
  --    "pause_ms": 0, "visual_note": "..." }], validated with Zod at the boundary.
  lines_json        jsonb not null default '[]'::jsonb check (jsonb_typeof(lines_json) = 'array'),
  cta               text check (char_length(cta) <= 200),
  status            public.script_status not null default 'draft',
  prompt_version    text,
  llm_usage_id      uuid references public.llm_usage (id) on delete set null,
  qa_report         jsonb not null default '{}'::jsonb,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (opportunity_id, version)
);

comment on column public.scripts.status is
  'approved/rejected/changes_requested are only set by an approvals row from another person.';

alter table public.scripts enable row level security;
revoke all on table public.scripts from anon;

create trigger scripts_keep_created_by
  before update on public.scripts
  for each row execute function public.keep_created_by();

create trigger scripts_set_updated_at
  before update on public.scripts
  for each row execute function public.set_updated_at();

create policy "scripts: members read"
  on public.scripts for select to authenticated
  using ((select public.is_member()));

create policy "scripts: editors create drafts"
  on public.scripts for insert to authenticated
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and status = 'draft'
    and created_by = (select auth.uid())
  );

create policy "scripts: editors edit drafts and send to review"
  on public.scripts for update to authenticated
  using (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and status in ('draft', 'changes_requested')
  )
  with check (
    (select public.has_any_role(array['admin', 'editor']::public.app_role[]))
    and status in ('draft', 'changes_requested', 'in_review')
  );

create trigger scripts_audit
  after insert or update or delete on public.scripts
  for each row execute function public.audit_row_change();
