# ADR 0005: Real platform uploads behind three keys, private only

- Status: accepted
- Date: 2026-11-18

## Context

Phase 4 adds adapters for YouTube, Instagram and TikTok. Rule 1 forbids real publishing during
development; any public test needs the owner's explicit authorization. The capabilities confirmed
in [docs/platforms.md](../platforms.md) show that YouTube and TikTok can upload as private, while
Instagram has no private or draft visibility through the API.

## Decision

- A real upload needs all of:
  1. the worker started with `PUBLISHING_MODE=live` (default and only value in local/CI:
     `simulated`);
  2. the channel's `live_uploads_enabled` switched on by an admin with a reason (audited);
  3. an `active`, unexpired credential for the channel (`credential_refs`).
     If any key is missing, the attempt fails with `FORBIDDEN` before any platform call.
- Visibility is a per-channel setting `upload_visibility`. Phase 4 only accepts `private`; a
  database CHECK rejects anything else, like the existing autopublish block. Adapters map it to
  `privacyStatus=private` (YouTube) and `SELF_ONLY` (TikTok). Instagram cannot honour it, so its
  adapter refuses (`FORBIDDEN`) and the manual package is the only path.
- `manual` channels never call a platform: the publication waits as `awaiting_manual` until an
  operator uploads the package by hand and records the permalink.
- Adapters persist a checkpoint (`publications.platform_checkpoint`) before every step whose
  outcome could be lost (YouTube session URI, TikTok `publish_id`, Instagram container id). The
  orchestrator passes it back to `reconcile`, so an ambiguous attempt is resolved against the
  platform before anything is sent again (rule 7). The checkpoint contains ids only, never tokens
  or signed URLs.
- Platform tokens live in Supabase Vault (`vault://` references), written only by server code.
  `env://` stays local only (ADR 0003).

## Consequences

- Switching to public publishing is a later, explicit change (Phase 6): a migration to relax the
  CHECK, the owner's written authorization, and for TikTok and Instagram the platform's audit or
  review.
- Each platform can be paused or turned off independently at three levels.
