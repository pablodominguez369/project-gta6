# ADR 0003: Secrets are referenced, never stored

- Status: accepted (backend for staging/production pending, decided in Phase 0)
- Date: 2026-11-17

## Context

Platform publishing needs OAuth tokens. Rule 6 forbids secrets in code, fixtures, logs, commits or
the application database.

## Decision

- `public.credential_refs.secret_ref` stores a URI (`scheme://path`); a CHECK constraint rejects
  anything that does not look like a reference, so a pasted token cannot be saved.
- Code resolves references at the moment of use through the `SecretStore` interface
  (`packages/connectors/src/secrets`).
- `EnvSecretStore` (`env://NAME`) exists for local development only and refuses to run when
  `APP_ENV` is `staging` or `production`.
- The production backend (cloud secret manager, or Supabase Vault) is chosen in Phase 0 with the
  cloud provider. Until then no real credentials are connected.

## Consequences

- Rotating a secret does not require a database change.
- Logs and audit details never contain secret values (enforced by `redact`).
