-- Phase 4 (T32): the YouTube checkpoint is a resumable upload session URI, which works as a
-- capability for that one upload. Members must not read it, so SELECT on publications becomes
-- column-level for signed-in users. The worker (direct connection) and the service role keep
-- full access. A new publications column must be added to this grant to be readable in the panel.

revoke select on table public.publications from authenticated;
grant select (
  id, channel_id, payload_json, status, idempotency_key, external_id, permalink, error_code,
  scheduled_at, published_at, created_by, created_at, updated_at, reconcile_required,
  next_attempt_at, render_id
) on public.publications to authenticated;
