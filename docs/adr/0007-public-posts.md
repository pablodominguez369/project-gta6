# ADR 0007: Public posts per channel, behind the owner's written authorization

- Status: accepted
- Date: 2026-11-19

## Context

ADR 0005 kept every real upload private. On 2026-11-19 the account owner gave his written
authorization to publish publicly. The platforms still apply their own locks, confirmed in the
official documentation on 2026-11-19:

- YouTube: videos uploaded through `videos.insert` from unverified API projects created after
  2020-07-28 are restricted to private until the project passes the YouTube API Services audit
  (<https://developers.google.com/youtube/v3/docs/videos/insert>).
- TikTok: content posted by unaudited clients is restricted to private (`SELF_ONLY`) until the
  app passes TikTok's audit (<https://developers.tiktok.com/doc/content-sharing-guidelines>).
- Instagram: no adapter is registered (ADR 0005); it stays manual.

## Decision

- New admin switch per channel: `channels.public_uploads_enabled`, allowed only on YouTube and
  TikTok, and only with `public_uploads_authorization` (where and when the owner authorized it).
  Changes are audited by the existing `channels_audit` trigger.
- Visibility is chosen per post (`payload_json.visibility`, default `private`), never by default
  (TikTok UX rules). The panel only offers "Público" on channels with the switch on.
- The worker re-checks on every attempt: a public post needs the three ADR 0005 keys plus the
  public switch (`evaluatePublishGates`). A forged payload alone can never publish publicly.
- Adapters map `public` to `privacyStatus=public` (YouTube) and `PUBLIC_TO_EVERYONE` (TikTok,
  only if the creator's `privacy_level_options` include it). Scheduling stays in our dispatcher;
  `status.publishAt` is not used.
- `channels.upload_visibility` and its private-only CHECK are kept unchanged and unused; the
  per-post choice replaces it.
- Global pause, channel pause, spend and frequency limits are unchanged (rule 8).

## Consequences

- Until the platform audits pass, a public request still ends up private on the platform. The
  manual path (download the render, upload by hand) is the fallback for public posts meanwhile.
- Before TikTok's audit the panel still needs the remaining UX items (creator nickname and
  preview, see docs/platforms.md).
