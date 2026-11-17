# End-to-end tests

Real browser (Playwright Chromium) against a running web server and local Supabase.
Test users are created with random passwords at start-up and deleted at the end.

```bash
pnpm supabase start                     # from the repo root
pnpm --filter @gta6/web build
pnpm --filter @gta6/web start &         # http://127.0.0.1:3000
pnpm --filter @gta6/web test:e2e
```

Environment (read from `apps/web/.env.local` or the shell):

- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`: local values from `pnpm supabase status`.
- `E2E_BASE_URL`: defaults to `http://127.0.0.1:3000`.

Never point these tests at staging or production: they create and delete users.
