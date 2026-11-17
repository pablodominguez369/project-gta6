# Database

Supabase Postgres. Migrations are plain SQL in `supabase/migrations`, applied in filename order.
RLS is enabled on every table in the migration that creates it, and `anon` has no privileges.

## Tables (Phase 1)

| Table             | Purpose                                  | Client writes                   |
| ----------------- | ---------------------------------------- | ------------------------------- |
| `user_roles`      | RBAC role assignments                    | admin                           |
| `system_controls` | Singleton: global pause, spend limits    | admin (update only)             |
| `channels`        | Publishing channels, mode, pause, limits | admin                           |
| `credential_refs` | References to secrets, never the secret  | admin                           |
| `publications`    | Publication intents and state            | admin/publisher insert `queued` |
| `job_runs`        | Business view of job executions          | none (worker via service role)  |
| `audit_events`    | Append-only audit log                    | none (triggers and server code) |

Rules enforced in SQL:

- `channels.mode` cannot be `autopublish` in Phase 1.
- `channels.timezone` must be a valid IANA zone.
- `credential_refs.secret_ref` must be a reference URI (`scheme://path`), not a token.
- `publications.idempotency_key` is unique; a `succeeded` publication must have an `external_id`.
- Spend limits default to `0` and only an admin can change them.
- `audit_events` rejects UPDATE, DELETE and TRUNCATE for every role, including `service_role`.
- Changes to `user_roles`, `system_controls`, `channels`, `credential_refs` and `publications` are
  audited automatically by trigger (changed columns and their new values; `secret_ref` excluded).

## Commands

```bash
pnpm db:start      # start only the local Postgres (Docker)
pnpm db:reset      # re-apply all migrations and supabase/seed.sql
pnpm db:test       # pgTAP tests in supabase/tests
pnpm supabase migration new <name>
pnpm supabase start   # full local stack (Auth, Storage, Studio) - needed from T6
```
