# Runbook: production setup (private uploads only)

Production as set up on 2026-11-18. Nothing here makes a post public (ADR 0005).

## Supabase

- Project `gta6-media-factory`, region `eu-west-3`, free plan.
- Migrations: apply `supabase/migrations` in order. Over the Supabase MCP server, statements that
  drop or delete ask for a human confirmation; run those files in the dashboard SQL editor instead.
  `supabase_migrations.schema_migrations` must list exactly the repository versions so a later
  `supabase db push` only sends new files.
- Auth: sign-ups off; Site URL = the panel URL; create users by hand (see
  [first-admin.md](first-admin.md)).

## Vercel (panel)

- Project `gta6-media-factory`, root directory `apps/web`, production branch `main`.
- Environment variables (Production and Preview): `APP_ENV=production`, `LOG_LEVEL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
  (sensitive), `APP_BASE_URL`, and per platform `YOUTUBE_OAUTH_CLIENT_ID` /
  `YOUTUBE_OAUTH_CLIENT_SECRET_REF`, `TIKTOK_OAUTH_CLIENT_KEY` / `TIKTOK_OAUTH_CLIENT_SECRET_REF`.
- Turborepo runs in strict env mode: a variable the build reads must be listed in the `build`
  task's `env` in `turbo.json`, or the build fails with "Invalid environment configuration".

## Platform OAuth secrets

1. The owner creates the OAuth client (Google Cloud) or app (TikTok for Developers) with redirect
   URI `APP_BASE_URL/admin/channels/oauth/callback`.
2. The client secret goes into Supabase Vault (Dashboard → Integrations → Vault → Add new secret),
   never into chat, code or Vercel as plain text.
3. `*_SECRET_REF` in Vercel is `vault://<secret id>` (the id is not secret).
4. Google: while the consent screen is in "Testing", refresh tokens expire after 7 days, so the
   channel must be reconnected weekly until the app is published.
5. TikTok: unaudited apps can only post `SELF_ONLY`, and only to private accounts. The sandbox
   allows testing with up to 10 owned accounts without app review.

## Worker

Not deployed yet. It needs a host that runs the Docker image in `apps/worker/Dockerfile` with
`DATABASE_URL` (direct or session pooler), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, the same OAuth
variables, and `PUBLISHING_MODE=simulated` until the owner switches a channel on.
