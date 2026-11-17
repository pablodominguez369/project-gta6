# Architecture

Modular monolith with asynchronous jobs. Module boundaries are enforced by package dependencies so
services can be split later if usage requires it.

```text
Admin panel (Next.js on Vercel)
      |  server actions / route handlers (enqueue only)
      v
Supabase Postgres  <---- pg-boss queue ---->  Worker (Node, off Vercel)
  (RLS, audit)                                    |
Supabase Auth / Storage                     Connectors (simulated in Phase 1)
```

## Packages and dependency rule

| Package                   | Responsibility                                     | May depend on       |
| ------------------------- | -------------------------------------------------- | ------------------- |
| `packages/domain`         | Entities, Zod schemas, errors, pure policies       | nothing internal    |
| `packages/config`         | Typed environment loading                          | `domain`            |
| `packages/observability`  | Logger with redaction                              | `domain`            |
| `packages/db`             | Supabase clients, generated types, repositories    | `domain`, `config`  |
| `packages/jobs`           | `JobQueue` interface, pg-boss implementation, jobs | `domain`, `db`, ... |
| `packages/connectors`     | Provider interfaces and simulators                 | `domain`            |
| `apps/web`, `apps/worker` | Composition only, no business rules                | any package         |

Only `packages/domain` exists after T1; the rest are added by their Phase 1 tasks.

## Phase 1 vertical slice

An admin creates a channel in Draft mode and enqueues a simulated publication. The worker processes
it with `SimulatedPublisher`, honours global and per-channel pause, de-duplicates by idempotency key,
reconciles ambiguous results before any retry, and writes every step to the audit log.

## Decisions

- [ADR 0001](adr/0001-monolith-nextjs-supabase.md): Next.js + Supabase modular monolith
- [ADR 0002](adr/0002-pg-boss-job-queue.md): pg-boss as the initial job queue
