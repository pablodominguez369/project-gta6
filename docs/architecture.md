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

| Package                   | Responsibility                                  | May depend on                                 |
| ------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `packages/domain`         | Entities, Zod schemas, errors, pure policies    | nothing internal                              |
| `packages/config`         | Typed environment loading                       | `domain`                                      |
| `packages/observability`  | Logger with redaction                           | `domain`                                      |
| `packages/db`             | Supabase clients, generated types, repositories | `domain`, `config`                            |
| `packages/jobs`           | `JobQueue`, pg-boss, publication orchestrator   | `domain`, `db`, `connectors`, `observability` |
| `packages/connectors`     | Provider interfaces and simulators              | `domain`                                      |
| `apps/web`, `apps/worker` | Composition only, no business rules             | any package                                   |

## Authentication

- Supabase Auth, email + password, sign-ups disabled. Keys: publishable (browser) and secret
  (server/worker only, bypasses RLS).
- `apps/web/proxy.ts` (Next 16 replacement for `middleware.ts`) refreshes the session with
  `@supabase/ssr` and redirects anonymous users to `/login`.
- `requireRole()` in pages and actions: no session → `/login`; missing role → HTTP 403.
- RLS remains the source of truth: a bypassed UI check still cannot read or write data.

## Phase 1 vertical slice

An admin creates a channel in Draft mode and enqueues a simulated publication. The worker processes
it with `SimulatedPublisher`, honours global and per-channel pause, de-duplicates by idempotency key,
reconciles ambiguous results before any retry, and writes every step to the audit log.

### Publication flow (T10)

```text
/admin/publications (admin, publisher)
   | insert publications(status=queued, idempotency_key from the form)   <- RLS, unique key
   v
dispatcher (worker, every 5 s)  -- outbox: queued | blocked past next_attempt_at | orphaned in_progress
   | enqueue publish.simulated, singletonKey = publication id (exclusive queue)
   v
processPublication (under a per-channel advisory lock)
   1. gates: global pause, channel pause, platform must be "simulated"   -> blocked / failed
   2. reconcile_required? ask the platform first; found -> succeeded (no new post)
   3. frequency limits in the channel time zone                          -> blocked
   4. commit reconcile_required = true, then publish
      ok -> succeeded | timeout -> ambiguous + retry (reconciles) | 429/503 -> retry
      expired credential / invalid / forbidden -> failed (no retry)
   5. no attempts left and still ambiguous -> stays ambiguous + audit
      publications.reconciliation_required (runbooks/ambiguous-publication.md)
```

Code: `packages/jobs/src/publishing/`. The worker writes publication state over a direct Postgres
connection (`DATABASE_URL`) so the status change and the advisory lock share the same database;
like the secret key it bypasses RLS and only exists in the worker. Ambiguous rows are never picked
up automatically after the last attempt: an operator decides (rule 7).

## Editorial research (Phase 2)

```text
allowlisted feeds / manual URL -> sources (metadata + 300-char excerpt)
  -> opportunity.build: same story within 72 h (title trigram similarity >= 0.5) -> opportunity
  -> assessment: confirmed (official source) | reported (2+ independent reliable) | rumor
     + risk flags (leak -> auto-discarded, spoiler, single_source, unknown_provenance)
     + score 0-100 (freshness, coverage, trust; rumors penalised) + expiry 72 h after latest source
  -> editor shortlists / accepts / discards with a reason
```

Code: `packages/domain/src/opportunity.ts` (pure rules) and `packages/jobs/src/opportunities/`.
The score orders what to look at first; only the certainty says what a script may state.

### Claims with evidence (T15)

An editor writes each claim on the opportunity page with its certainty, a "sensitive" flag and
the sources behind it. `evaluateClaimEvidence` (`packages/domain/src/claim-evidence.ts`) decides
whether the sources back the declared certainty:

- `confirmed` needs an official/primary source; `reported` needs two independent reliable
  publishers (or an official source).
- A sensitive claim (dates, prices, people, health...) needs an official source or two reliable
  publishers whatever its certainty; a single non-official source raises `sensitive_single_source`.
- Factual claims need a dated source; rumors, speculation and opinion are always labelled.

The web action refuses claims that fail the check, and a second editor (never the author) verifies
them. Because editors could write claims through the API directly, the script QA (T17) runs the
same check again on every claim a script cites; the database also refuses factual claims without a
source and drops a verification when the claim or its sources change.

## Decisions

- [ADR 0001](adr/0001-monolith-nextjs-supabase.md): Next.js + Supabase modular monolith
- [ADR 0002](adr/0002-pg-boss-job-queue.md): pg-boss as the initial job queue
- [ADR 0003](adr/0003-secret-references.md): secrets are referenced, never stored

Connectors and the publisher contract: [connectors.md](connectors.md).
