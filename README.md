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

## Workspace layout

```text
apps/            # web (Next.js) and worker (Node) - added in later Phase 1 tasks
packages/
  domain/        # entities, errors, Result type, pure policies
docs/            # spec, architecture, ADRs, runbooks
```
