# Runbook: global and channel pause

The pause is the emergency brake (rule 8). It is checked by the worker on **every** attempt, not
only when a publication is enqueued, so pausing also stops jobs that are already queued.

## Pause

- **Whole system:** `/admin/controls` → reason (3–500 characters) → "Pausa global". Admin only.
- **One channel:** `/admin/channels` → row → reason → "Pausar". Admin only.

Both changes are audited (`system_controls.update` / `channels.update`) with the admin as actor.
A red banner shows the global pause on every console page.

## What happens while paused

- New and queued publications become `blocked` with `error_code = SYSTEM_PAUSED` or
  `CHANNEL_PAUSED`. Nothing is sent to any platform, not even a reconciliation lookup.
- The dispatcher does not pick blocked publications while the pause is on, so no job runs pile up.
- A publication that was `ambiguous` keeps `reconcile_required = true`: after resuming, its next
  attempt checks the platform first and cannot create a duplicate.
- Pausing never raises or lowers frequency or spend limits.

## Resume

1. Confirm the reason for the pause is resolved.
2. `/admin/controls` → "Reanudar sistema", or the channel's "Reanudar" button.
3. Within about a minute the dispatcher picks up blocked publications (`next_attempt_at` is 60 s
   after the block). Check `/admin/publications` and `/admin/jobs`.

## Verify

```sql
select global_paused, paused_reason, updated_by, updated_at from public.system_controls;
select id, display_name, paused, paused_reason from public.channels where paused;
select status, error_code, count(*) from public.publications group by 1, 2;
```
