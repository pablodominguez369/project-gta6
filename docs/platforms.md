# Platform capabilities (verified for Phases 4 and 5)

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

## Analytics (Phase 5)

Checked against the official documentation on **2026-11-18**. See
[ADR 0006](adr/0006-analytics-with-uncertainty.md) for how the numbers are used.

### YouTube

Sources: [reports.query](https://developers.google.com/youtube/analytics/reference/reports/query),
[metrics](https://developers.google.com/youtube/analytics/metrics),
[authorization](https://developers.google.com/youtube/reporting/guides/authorization),
[videos resource](https://developers.google.com/youtube/v3/docs/videos).

- Counters: Data API `GET /youtube/v3/videos?part=statistics&id=...` (`viewCount`, `likeCount`,
  `commentCount`) with `youtube.readonly`, already requested in Phase 4.
- Report: `GET https://youtubeanalytics.googleapis.com/v2/reports` with `ids=channel==MINE`,
  `startDate`/`endDate` (`YYYY-MM-DD`), `metrics=...` and `filters=video==VIDEO_ID`. The JSON
  answer has `columnHeaders` and `rows`; `rows` is omitted when there is no data.
- Metrics used: `views`, `likes`, `comments`, `shares`, `estimatedMinutesWatched`,
  `averageViewDuration`, `averageViewPercentage`, `subscribersGained`.
- Scopes: the reference lists `yt-analytics.readonly`; the authorization guide says
  `youtube.readonly` also allows non-monetary reports. We request `yt-analytics.readonly`
  explicitly and do not depend on the second statement.
- The owner must enable the "YouTube Analytics API" in the Google Cloud project.
- Caveats from the docs: "views" means different things in different reports; average duration
  and percentage exclude looping clips since 2021-12-13. Data latency is not documented, so a
  window is read again on the next run until it is complete (see below).

### TikTok

Sources: [video query](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query),
[video object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object),
[scopes](https://developers.tiktok.com/docs/en/tiktok-api-scopes),
[Display API get started](https://developers.tiktok.com/docs/en/display-api-get-started).

- `POST https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count`
  with body `{"filters":{"video_ids":[...]}}`, up to 20 ids per request.
- Scope `video.list`: "Read a user's public videos on TikTok". Needs Login Kit plus the TikTok API
  product approved for `user.info.basic` and `video.list`.
- **Only public videos**: a `SELF_ONLY` upload from Phase 4 is not expected to be returned, and
  the adapter treats a missing video as "no data", never as zero.
- No watch time, reach or retention through this API. Rate limits are not stated on the page.

### Instagram

Source: [media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights).

- `GET graph.instagram.com/<MEDIA_ID>/insights`, permissions `instagram_business_basic` and
  `instagram_business_manage_insights`.
- Reels metrics: `views`, `reach`, `likes`, `comments`, `shares`, `saved`,
  `total_interactions`, `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`,
  `reels_skip_rate`, `reposts`. `impressions` is deprecated for media after 2024-07-02.
- Data can be delayed up to 48 hours; an unavailable metric comes back as an empty set, not `0`;
  data is kept for up to 2 years.
- There is no Instagram connection in this project, so Instagram metrics are **entered by hand**.
