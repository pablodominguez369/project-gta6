# ADR 0002: pg-boss as the initial job queue

- Status: accepted
- Date: 2026-11-17

## Context

The specification recommends Temporal, or BullMQ with Redis for an MVP. Phase 1 needs persistent
jobs that survive restarts, retries with backoff and scheduling, without adding infrastructure to
operate.

## Decision

- Use pg-boss on the existing Supabase Postgres database, behind a `JobQueue` interface in
  `packages/jobs`.
- Jobs are consumed by `apps/worker`, a long-running Node process deployed outside Vercel.
- Business state (for example `publications.status`) lives in our own tables; pg-boss only holds
  technical job state. A `job_runs` table gives the panel a business view of executions.

## Consequences

- No Redis or Temporal to run in Phase 1.
- The `JobQueue` interface allows replacing pg-boss (Temporal, BullMQ, Supabase Queues) later.
- pg-boss 12 keeps its tables in the `pgboss` schema (outside `public`, so PostgREST never exposes
  them) and creates/migrates them on start, which needs a role with CREATE on the database.
- Verified locally against a direct Postgres connection. Still to verify before staging: the
  Supabase connection mode for the hosted project (direct or session pooler; transaction pooling
  is not expected to work because pg-boss holds sessions). pg-boss also offers an HTTP proxy
  package for pooled environments; not evaluated.
- Queues that must never run the same work twice concurrently use the `exclusive` policy with a
  `singletonKey` (one queued-or-active job per key). Queue policies cannot change in place.
- Heavy render queues (Phase 3) may need a dedicated queue or worker pool; revisit then.
