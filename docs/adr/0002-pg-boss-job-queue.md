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
- To verify before T8: the connection mode pg-boss needs with Supabase (direct connection or session
  pooler; transaction pooling is likely incompatible). Check the pg-boss and Supabase docs.
- Heavy render queues (Phase 3) may need a dedicated queue or worker pool; revisit then.
