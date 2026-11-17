# ADR 0001: Next.js + Supabase modular monolith

- Status: accepted
- Date: 2026-11-17

## Context

The specification (section 3.3) suggests a separate API app (NestJS or Fastify), PostgreSQL with
Prisma or Drizzle, and S3-compatible storage. The team works daily with Next.js (App Router),
Supabase and Vercel, and Phase 1 must stay small and operable by one person.

## Decision

- The Next.js app in `apps/web` serves both the admin panel and the API (route handlers and server
  actions). There is no separate `apps/api` in Phase 1.
- Supabase provides Postgres, Auth and Storage. Schema changes are plain SQL migrations managed by
  the Supabase CLI, with RLS enabled on every table in the migration that creates it. TypeScript
  types are generated with `supabase gen types`.
- Business rules live in workspace packages (`packages/*`), not in the apps, so the API can be
  extracted into its own service later without rewriting domain code.
- Long-running work runs in a separate worker process, never in Vercel functions, because those have
  a maximum execution duration.

## Consequences

- One deployment target for the UI and API; fewer moving parts.
- No ORM: queries go through the Supabase client or SQL, typed from generated types.
- RLS is the main data-access control, so every table needs policy tests (pgTAP).
- The service role key must stay server-side only; enforced by lint rules, `server-only` imports and
  secret scanning.
