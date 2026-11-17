# AGENTS.md

Instructions for any human or AI agent working in this repository. Read
[docs/GTA-6-Media-Factory-Especificacion-Tecnica.md](docs/GTA-6-Media-Factory-Especificacion-Tecnica.md)
before proposing changes. Product docs are in Spanish; code, identifiers and comments are in English.

## Non-negotiable rules

1. **No real publishing during development.** Use simulators and Draft mode by default. Any public
   test requires explicit authorization from the account owner and correctly configured credentials.
2. **Never assume API permissions.** Before implementing a publisher, check the current official
   documentation: scopes, review/audit, quotas, eligibility and required UX. Document confirmed
   capabilities and external dependencies; always provide a manual fallback.
3. **No leaks, stolen content, private-account material or ToS-violating scraping.** A public trailer
   is not a license. Every asset needs recorded rights and `cleared`/`original` status for
   autopublish; otherwise it is blocked.
4. **No factual claims without sources.** Every script claim needs a reference, date and confidence
   level; rumors are labeled. Never invent quotes or links.
5. **No cloning identifiable voices without consent/license.** Record provider, voice, license and
   required synthetic-content disclosures.
6. **Never store secrets in code, fixtures, logs or commits.** Use secret-manager references,
   minimal scopes, RBAC and audit.
7. **Idempotent publishing.** On timeout, query the external state before retrying. Never risk a
   duplicate because of an ambiguous result.
8. **Keep global pause, per-channel pause, spend limits and frequency limits.** Never raise them
   automatically.
9. **Keep LLM, TTS, discovery and each platform behind swappable interfaces.** Domain logic must not
   depend on a single provider.
10. **No features that automate likes, comments, followers or limit evasion.**

## Architecture (Phase 1)

- pnpm + Turborepo monorepo. TypeScript strict everywhere.
- `apps/web`: Next.js App Router on Vercel (admin panel, route handlers, server actions). It only
  enqueues work; long jobs never run on Vercel.
- `apps/worker`: separate Node process consuming jobs (pg-boss).
- `packages/domain`: entities, Zod schemas, pure policies. Imports nothing from other workspace
  packages or providers.
- `packages/{config,db,jobs,connectors,observability}` depend on `domain`, never the reverse.
- Supabase: Postgres (SQL migrations via Supabase CLI, RLS enabled on every table), Auth, Storage.
- See [docs/architecture.md](docs/architecture.md) and [docs/adr/](docs/adr/).

## Conventions

- Domain functions return `Result<T, DomainError>` instead of throwing. Error codes live in
  `packages/domain/src/errors.ts`; never rename or reuse a code.
- Validate every external input and output with Zod at the boundary.
- Structured logs only (no `console.*`); sensitive fields are redacted.
- `SUPABASE_SECRET_KEY` (bypasses RLS) is server/worker only: never `NEXT_PUBLIC_*`, never imported from a
  client component.
- Migrations are reviewable SQL, one concern per file, and enable RLS in the same migration that
  creates the table.
- Every change adds relevant unit/contract/integration tests, especially for rights, permissions,
  timezone/DST, idempotency, ambiguous states and simulated publishing.
- Update docs, `.env.example` (no real values), ADRs and runbooks when the design changes.
- If a policy, permission or requirement is uncertain, implement a safe block and leave an
  adapter/fallback. Do not claim a capability exists.

## Commands

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

All four checks must pass before opening a PR.
