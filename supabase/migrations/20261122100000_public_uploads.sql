-- Phase 6: public posts per channel, behind the owner's written authorization (ADR 0007).
-- A public post needs every Phase 4 key (worker in live mode, live_uploads_enabled, an active
-- credential) plus this switch, re-checked by the worker on every attempt. The platforms add
-- their own lock: YouTube keeps uploads from unaudited API projects private and TikTok only
-- accepts SELF_ONLY from unaudited apps, so nothing becomes public before their review.

alter table public.channels
  add column public_uploads_enabled       boolean not null default false,
  add column public_uploads_authorization text
    check (char_length(public_uploads_authorization) <= 1000),
  -- Only platforms with a registered adapter that can post publicly. Instagram stays manual.
  add constraint channels_public_uploads_platform
    check (not public_uploads_enabled or platform in ('youtube', 'tiktok')),
  -- Every switch-on records where the owner's written authorization is (audited by trigger).
  add constraint channels_public_uploads_authorization_required
    check (not public_uploads_enabled
           or coalesce(char_length(trim(public_uploads_authorization)), 0) >= 10);

comment on column public.channels.public_uploads_enabled is
  'Admin switch for public posts on this channel (ADR 0007). Off by default; also needs live uploads.';
comment on column public.channels.public_uploads_authorization is
  'Reference to the owner''s written authorization for public posts (date and where it was given).';
