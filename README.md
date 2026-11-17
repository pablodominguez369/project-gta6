# GTA 6 Media Factory

Private platform for research, vertical video production and multi-platform publishing in Spanish.
Built incrementally as a modular monolith with asynchronous workflows.

- Product and technical specification (Spanish):
  [docs/GTA-6-Media-Factory-Especificacion-Tecnica.md](docs/GTA-6-Media-Factory-Especificacion-Tecnica.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Decisions: [docs/adr/](docs/adr/)
- Rules for contributors and agents: [AGENTS.md](AGENTS.md)

## Status

Phase 1 (foundations) in progress. No real platform connectors exist; publishing is simulated only.

## Requirements

- Node.js 24 LTS (see `.nvmrc`; Node >= 22.13 also works)
- pnpm via Corepack (version pinned in `package.json` → `packageManager`)
- Docker and Supabase CLI (from task T5 onwards)

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env.local   # local, non-production values only
pnpm lint
pnpm typecheck
pnpm test
```

## Database

See [docs/database.md](docs/database.md). Quick start:

```bash
pnpm db:start   # requires Docker
pnpm db:test
```

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

- `checks`: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- `database`: starts a local Supabase Postgres, applies all migrations and runs the pgTAP suite.
- `secret-scan`: gitleaks (pinned version, checksum-verified) over the full git history, using
  `.gitleaks.toml` (default rules plus Supabase key rules). Any finding fails the build.

To scan locally before pushing (requires the gitleaks binary):

```bash
gitleaks git --config .gitleaks.toml --redact --verbose .
```

If a real secret is ever committed: rotate it first, then purge it from history. Never allowlist it.

## Workspace layout

```text
apps/            # web (Next.js) and worker (Node) - added in later Phase 1 tasks
packages/
  domain/        # entities, errors, Result type, pure policies
  config/        # typed environment loading
  observability/ # logger with secret redaction
supabase/        # SQL migrations, pgTAP tests, local seed
docs/            # spec, architecture, database, ADRs, runbooks
```
