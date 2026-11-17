# Runbook: create the first admin

Sign-ups are disabled (`enable_signup = false` in `supabase/config.toml`), so users are created by
an operator. Roles are assigned in `public.user_roles`; nobody can grant themselves a role.

## Local

1. Start Supabase: `pnpm supabase start` (Studio runs at the URL it prints).
2. In Studio → Authentication → Users → "Add user", create the user with a password of at least
   12 characters.
3. In Studio → SQL editor, assign the role (replace the email):

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'you@example.com';
   ```

4. The change is recorded in `public.audit_events` as `user_roles.insert` with `actor_type = 'system'`.

## Staging / production

Same steps in the Supabase dashboard of that project. Use a real person's account, never a shared
one, and enable MFA for admins once the console supports it. Further admins are granted from the
console by an existing admin, so the audit log records who granted them.
