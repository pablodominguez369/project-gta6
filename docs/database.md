# Database

Supabase Postgres. Migrations are plain SQL in `supabase/migrations`, applied in filename order.
RLS is enabled on every table in the migration that creates it, and `anon` has no privileges.

## Tables (Phase 1)

| Table                      | Purpose                                  | Client writes                   |
| -------------------------- | ---------------------------------------- | ------------------------------- |
| `user_roles`               | RBAC role assignments                    | admin                           |
| `system_controls`          | Singleton: global pause, spend limits    | admin (update only)             |
| `channels`                 | Publishing channels, mode, pause, limits | admin                           |
| `credential_refs`          | References to secrets, never the secret  | admin                           |
| `publications`             | Publication intents and state            | admin/publisher insert `queued` |
| `job_runs`                 | Business view of job executions          | none (worker via service role)  |
| `simulated_platform_posts` | Fake platform storage (simulator only)   | none (no API access at all)     |
| `audit_events`             | Append-only audit log                    | none (triggers and server code) |

Rules enforced in SQL:

- `channels.mode` cannot be `autopublish` in Phase 1.
- `channels.timezone` must be a valid IANA zone.
- `credential_refs.secret_ref` must be a reference URI (`scheme://path`), not a token.
- `publications.idempotency_key` is unique; a `succeeded` publication must have an `external_id`.
- Clients can only insert fresh publications (`queued`, `reconcile_required = false`, no
  `next_attempt_at`); every later state change is made by the worker.
- `publications.reconcile_required` is committed before any platform call and never cleared while
  the row is not terminal: every later attempt reconciles first.
- `simulated_platform_posts` deliberately allows duplicate keys (like a non-idempotent API), so tests
  can prove the orchestrator never creates one.
- A feed can only be enabled once its terms URL and review date are recorded.
- `sources.excerpt` holds at most 300 characters; the full third-party article is never stored.
- A `confirmed` or `reported` claim must cite at least one source (checked at commit).
- A script reaches `approved`, `rejected` or `changes_requested` only through an `approvals` row
  by someone other than its author, and only while it is `in_review`. Approvals are append-only.
- `created_by` on claims and scripts cannot be changed after insert.
- Spend limits default to `0` and only an admin can change them.
- The last admin cannot be removed (role delete or user delete is rejected).
- `audit_events` rejects UPDATE, DELETE and TRUNCATE for every role, including `service_role`.
- Changes to `user_roles`, `system_controls`, `channels`, `credential_refs` and `publications` are
  audited automatically by trigger (changed columns and their new values; `secret_ref` excluded).

## Commands

```bash
pnpm db:start      # start only the local Postgres (Docker)
pnpm db:reset      # re-apply all migrations and supabase/seed.sql
pnpm db:test       # pgTAP tests in supabase/tests
pnpm db:types      # regenerate packages/db/src/database.types.ts (CI fails if it is stale)
pnpm supabase migration new <name>
pnpm supabase start   # full local stack (Auth, Storage, Studio) - needed from T6
```
