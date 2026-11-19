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

## Worker (Railway)

- Railway service `@gta6/worker` from this repository, branch `main`, no root directory, built
  from the Dockerfile via `RAILWAY_DOCKERFILE_PATH=apps/worker/Dockerfile`. Watch paths
  `/apps/worker/**` and `/packages/**`. No public networking.
- Variables: `APP_ENV=production`, `LOG_LEVEL`, `PUBLISHING_MODE=simulated` (until the owner
  switches real private uploads on), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`
  (Supavisor **session** pooler, port 5432: pg-boss needs session features), `APP_BASE_URL`, the
  four OAuth variables, and for narration `TTS_PROVIDER=google` + `TTS_CREDENTIALS_REF`.
- A database password with URL-special characters (`@ # / : ? %`) breaks `DATABASE_URL`; use
  letters and digits or percent-encode it.

## Google Text-to-Speech

1. In the same Google Cloud project: enable "Cloud Text-to-Speech API" and billing (required even
   for the free tier).
2. IAM → Service accounts → create one. We found no role documented for `text:synthesize`, so start
   with none and add one only if Google answers 403. Then Keys →
   Add key → JSON. Paste the whole file content into Vault as `google_tts_service_account`.
3. Railway: `TTS_PROVIDER=google`, `TTS_CREDENTIALS_REF=vault://<secret id>`.
4. Panel: set a spend limit above 0 in Controles, register the license (Google terms, commercial
   use confirmed by the owner) and the voice (`es-ES-Chirp3-HD-<Name>`, provider `google`), and
   approve it.
