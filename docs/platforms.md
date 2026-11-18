# Platform capabilities (verified for Phase 4)

Checked against the official documentation on **2026-11-18**. Each adapter repeats the date and
the URLs in `capabilities.verifiedAgainstDocsAt` / `docsUrls`. Re-check before enabling a channel
for real uploads, and whenever a platform announces a change. Anything not listed here is treated
as unavailable (rule 2).

Phase 4 never makes anything public: see [ADR 0005](adr/0005-live-publishing-gates.md).

## YouTube (Shorts)

Sources: [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert),
[resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol),
[videos resource](https://developers.google.com/youtube/v3/docs/videos),
[getting started / quota](https://developers.google.com/youtube/v3/getting-started),
[required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality).

Confirmed:

- `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`.
  Scope: `https://www.googleapis.com/auth/youtube.upload` (the minimal one of the four accepted).
- Resumable session: the start request sends `X-Upload-Content-Length` and
  `X-Upload-Content-Type`; the `Location` header is the session URI. An interrupted upload is
  checked with an empty `PUT` and `Content-Range: bytes */SIZE`: `308` = incomplete (the `Range`
  header says how much arrived), `201` = done (body is the video resource). An expired session
  answers `404`; its lifetime is not documented. `500/502/503/504` are resumable with backoff.
- Settable status fields: `privacyStatus`, `publishAt`, `selfDeclaredMadeForKids`,
  `containsSyntheticMedia`. Without `privacyStatus` the video defaults to **public**, so the
  adapter always sends it.
- Quota: 1 unit in the "Video Uploads" bucket, listed as 100 calls per day. The effective quota
  depends on the Google Cloud project.
- As of the check date the reference says: "Videos uploaded from unverified API projects are not
  restricted to private viewing mode." Earlier versions of the page said the opposite; we do not
  depend on either, because Phase 4 only uploads as private.
- There is no separate Shorts API: Shorts eligibility is decided by YouTube (vertical, short).
- No idempotency key. Reconciliation uses the stored resumable session URI.

Owner dependencies: Google Cloud project, YouTube Data API v3 enabled, OAuth consent screen, web
OAuth client, channel authorization. Fallback: manual package.

## Instagram (Reels)

Sources: [content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/),
[resumable uploads](https://developers.facebook.com/documentation/instagram-platform/content-publishing/resumable-uploads),
[content_publishing_limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit).

Confirmed:

- Instagram professional accounts only.
- Instagram Login: host `graph.instagram.com`, Instagram user token, permissions
  `instagram_business_basic` and `instagram_business_content_publish`. (Facebook Login uses
  `graph.facebook.com`, a Page token and `instagram_basic`, `instagram_content_publish`,
  `pages_read_engagement`.) We use Instagram Login: no Facebook Page needed.
- Flow: `POST /<IG_ID>/media` with `media_type=REELS` and `video_url` → poll
  `GET /<CONTAINER_ID>?fields=status_code` (`IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED`,
  `PUBLISHED`; at most once a minute for 5 minutes) → `POST /<IG_ID>/media_publish` with
  `creation_id`. A container not published within 24 hours expires.
- With Instagram Login the video must be at a **publicly reachable URL** (Meta fetches it).
  Resumable local uploads are documented only for Facebook Login. We would use a short-lived signed
  Storage URL created at upload time, never stored.
- Limit: 100 API-published posts per 24-hour moving window; check `content_publishing_limit`.
- **No private or draft visibility** and no scheduling field: anything published is public.
- No idempotency key. Reconciliation uses the stored container id (`status_code=PUBLISHED`).

Consequence: Instagram uploads stay **blocked** in Phase 4 (public only). The adapter exists and
is tested against a fake server, but only the manual package is usable. Owner dependencies:
professional account, Meta app with Instagram Login, app review for the publishing permission.

## TikTok

Sources: [get started](https://developers.tiktok.com/doc/content-posting-api-get-started),
[Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post),
[media transfer](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide),
[post status](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status),
[UX guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines).

Confirmed:

- App with the Content Posting API product and Direct Post enabled, approved for `video.publish`,
  and the user's authorization for that scope.
- "All content posted by unaudited clients will be restricted to private viewing mode"; unaudited
  clients can only post to private accounts. An audit lifts this.
- Flow: `POST /v2/post/publish/creator_info/query/` (allowed privacy levels, max duration) →
  `POST /v2/post/publish/video/init/` with `source=FILE_UPLOAD` (`video_size`, `chunk_size`,
  `total_chunk_count`) → `PUT` each chunk to `upload_url` with `Content-Range` → poll
  `POST /v2/post/publish/status/fetch/` with `publish_id` (`PROCESSING_UPLOAD`,
  `PROCESSING_DOWNLOAD`, `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, `FAILED`).
- `post_info.privacy_level` must be one of the creator's `privacy_level_options`; `is_aigc=true`
  labels AI-generated content; `title` up to 2200 UTF-16 units.
- Chunks: 5 MB to 64 MB (last one up to 128 MB), 1 to 1000 chunks; a file under 5 MB is sent as one
  chunk. `upload_url` is valid for 1 hour. Video: MP4/WebM/MOV, H.264 recommended, up to 4 GB,
  10 minutes, 360 to 4096 px per side.
- Rate limits: init 6 requests/minute per user token; status 30 requests/minute.
- `PULL_FROM_URL` needs a verified domain; we use `FILE_UPLOAD`.
- Required UX: show the creator nickname, the user picks the privacy level with no default,
  interaction toggles off by default, commercial-content toggle off by default, show "By posting,
  you agree to TikTok's Music Usage Confirmation", show a preview, editable title, no added
  watermarks, and tell the user processing can take a few minutes. Content is sent only after
  the user's express consent.
- No idempotency key. Reconciliation uses the stored `publish_id`.

Consequence: Phase 4 only allows `SELF_ONLY`, chosen explicitly by a person when queuing. Owner
dependencies: TikTok for Developers app, Content Posting product, `video.publish` approval, audit
for any public post.

## Render compatibility

The Phase 3 master (vertical 1080x1920 H.264/AAC MP4) fits all three, so no per-platform encode is
added. Adapters validate duration and size and refuse with `VALIDATION_FAILED` (then the manual
package is the fallback).
