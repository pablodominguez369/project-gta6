# Connectors

All external providers sit behind interfaces in `packages/connectors`. The domain never imports a
vendor SDK directly.

| Interface           | Phase 1 implementation                                          | Status                                         |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `PublisherAdapter`  | `SimulatedPublisher`                                            | Implemented, contract-tested                   |
| `LlmProvider`       | `FakeLlmProvider`, `AnthropicLlmProvider`                       | Off by default, spend-gated                    |
| `TtsProvider`       | `FakeTtsProvider` (tone per word, local), `DisabledTtsProvider` | No real adapter yet (owner to pick a provider) |
| `DiscoveryProvider` | `FeedDiscoveryProvider` (RSS 2.0 / Atom)                        | Allowlisted feeds only                         |
| `SecretStore`       | `EnvSecretStore` (local only)                                   | Implemented                                    |

## LLM (Phase 2)

See [ADR 0004](adr/0004-llm-provider-and-spend-gate.md). `LLM_PROVIDER=disabled` by default; even
with `anthropic`, every call is refused while the spend limits are 0. Calls only happen through
`generateWithSpendGate` in the worker, which records each one in `llm_usage` (no prompts or
outputs). Confirmed capabilities used: Messages API, structured JSON output, server-side refusal
fallback. External dependency: an Anthropic API key and account with billing, owned by the owner.

## Discovery (Phase 2)

`FeedDiscoveryProvider` reads one allowlisted RSS 2.0 or Atom feed. The worker job `discovery.poll`
runs every 5 minutes and polls each enabled feed whose interval (15 to 1440 minutes) has passed.

- An admin adds a feed in `/admin/sources`; it stays disabled until they record the terms URL and
  confirm the terms allow automated use. Editors can also add single URLs by hand.
- HTTPS only (redirects to HTTP are refused), 10 s timeout, 2 MB limit, at most 100 items per poll,
  documents with a DTD are refused (entity expansion).
- 401/403 means we lack access and is never worked around (rule 3). 429 and errors count as
  failures; after 5 in a row the feed is disabled and `feed_sources.auto_disabled` is audited.
- Stored per item: canonical URL (tracking parameters removed), title, dates, an excerpt of at most
  300 characters, a SHA-256 hash. Never the full article.
- User agent: generic `MediaFactoryFeedReader/0.1`, no personal data.
- Nothing is polled while the global pause is on.

## Publisher contract

`packages/connectors/src/publisher/__tests__/publisher-contract.ts` defines the behaviour every
adapter must pass before it can be enabled: explicit capabilities, validation errors as
`VALIDATION_FAILED`, external id on success, reconciliation of its own uploads, `NOT_FOUND` for
unknown ids, and known error codes only. Adapters are **not** required to be idempotent: the
orchestrator (T10) avoids duplicates by reconciling before any retry.

## Simulated publisher faults

`timeout_after_accept`, `timeout_before_accept`, `rate_limited`, `credential_expired`,
`unavailable`, `reconcile_unavailable`. The simulator behaves like a non-idempotent platform:
publishing the same request twice creates two posts, so tests can prove the orchestrator prevents
duplicates.

## Real platforms (Phase 4)

Capabilities were checked against the official docs on 2026-11-18; see
[platforms.md](platforms.md). The gates for real uploads are in
[ADR 0005](adr/0005-live-publishing-gates.md): nothing is ever made public in Phase 4.

| Platform        | Upload path                                 | Phase 4 visibility   | Manual fallback |
| --------------- | ------------------------------------------- | -------------------- | --------------- |
| YouTube Shorts  | Data API v3 resumable `videos.insert`       | Private only         | Yes             |
| TikTok          | Content Posting Direct Post, `FILE_UPLOAD`  | `SELF_ONLY` only     | Yes             |
| Instagram Reels | Instagram Login container + `media_publish` | Blocked (no private) | Yes (only path) |

## Connecting accounts (T31)

- Admins connect a YouTube or TikTok channel from **Canales** ("Conectar cuenta"). The panel
  sends them to the platform's consent screen with a random `state` kept in an httpOnly cookie
  (10 minutes, callback path only); the callback checks it, exchanges the code on the server and
  stores the token set in Supabase Vault with `store_channel_credential` (service role only).
  `credential_refs` keeps `vault://<id>`, the scopes and the refresh-token expiry; older
  credentials of the channel are revoked and their secrets deleted.
- Scopes: YouTube `youtube.upload` + `youtube.readonly` (status of our own uploads); TikTok
  `video.publish`. Instagram is not connected in Phase 4 (no private visibility).
- The worker reads tokens with `PgChannelTokens`, refreshing them 10 minutes before expiry inside
  the channel lock (TikTok rotates the refresh token on every refresh). A rejected refresh
  (`invalid_grant`) marks the credential `expired` and publications fail with
  `CREDENTIAL_EXPIRED` until an admin reconnects.
- "Desconectar" revokes the credential, deletes the secret and switches real uploads off.
- OAuth client secrets are references too (`*_CLIENT_SECRET_REF`), resolved at the moment of use.

## YouTube adapter (T32)

`YouTubePublisher` (`packages/connectors/src/publisher/youtube`). Contract-tested against an
in-memory fake of the Data API; it never reaches the network in tests.

- Uploads with `privacyStatus=private`, `selfDeclaredMadeForKids=false` (GTA content is not made
  for children), `containsSyntheticMedia` from the render, category Gaming. `publishAt` is never
  sent: it would make the private video public at that time.
- Rejects titles or descriptions with `<` or `>`, descriptions over 5000 bytes and any
  `scheduledAt` before calling YouTube.
- Starts a resumable session, saves `{sessionUri, sizeBytes}` as checkpoint, then sends the file.
  A lost answer is `AMBIGUOUS_EXTERNAL_STATE`; reconciliation asks the session
  (`Content-Range: bytes */size`): `201` = the video exists, `308`/`404` = no video, anything else
  = error (never "not found").
- The checkpoint works as a capability for that upload, so members cannot read
  `publications.platform_checkpoint` (column privileges) and it is cleared once the post exists.
- `getStatus` uses `videos.list?part=status` (needs `youtube.readonly`).
- Errors: 401 → `CREDENTIAL_EXPIRED`; `quotaExceeded`/`uploadLimitExceeded`/429 → `RATE_LIMITED`;
  other 403 → `FORBIDDEN`; 400 → `VALIDATION_FAILED`; 5xx/network before the upload →
  `EXTERNAL_UNAVAILABLE`.

## TikTok adapter (T33)

`TikTokPublisher` (`packages/connectors/src/publisher/tiktok`), contract-tested against an
in-memory fake of the Content Posting API.

- `creator_info/query` first: the account must allow `SELF_ONLY`, otherwise `FORBIDDEN`.
- `video/init` with `FILE_UPLOAD`, `privacy_level=SELF_ONLY`, comments/duet/stitch disabled,
  commercial toggles off, `is_aigc` from the render. Caption = title + description, at most 2200
  characters.
- The `publish_id` is saved as checkpoint before the first chunk. Chunks of 10 MB (a file under
  5 MB is one chunk; the remainder joins the last chunk). A lost chunk answer is
  `AMBIGUOUS_EXTERNAL_STATE`.
- Reconciliation reads `status/fetch`: `PUBLISH_COMPLETE`/`SEND_TO_USER_INBOX` = exists,
  `FAILED` or unknown `publish_id` = safe to post again, anything still processing = error
  (the publication stays ambiguous and is retried or reconciled by hand, never posted twice).
- Private posts get no public post id, so `external_id` is the `publish_id` and there is no
  permalink.
- The person queuing must pick the visibility explicitly (no default, TikTok UX rules); the
  adapter refuses requests without `visibilityConfirmed`. Still pending before any TikTok audit
  (Phase 6): showing the creator's nickname and a preview in the panel before posting.

## Instagram adapter (T34)

`InstagramPublisher` (`packages/connectors/src/publisher/instagram`), contract-tested against an
in-memory fake of the Graph API (Instagram Login). **Not registered in the worker**: Instagram
has no private visibility, so `privateVisibility=false` and the orchestrator refuses it, and the
adapter itself refuses every post unless `publicPostsAuthorized` is set (only tests do).

- Reel container with `video_url` = a signed Storage URL created at that moment (never stored),
  status polling (once a minute, up to 5 times), then `media_publish`.
- Checkpoint: the container id. Reconciliation: `status_code=PUBLISHED` = the Reel exists
  (matched by caption among recent media for the permalink); anything else = not published (an
  unpublished container expires after 24 h).
- `graphVersion` has no default: set it from Meta's changelog when enabling, after re-checking.
- Before enabling (Phase 6): an Instagram Login OAuth provider, the owner's written authorization
  for public posts, Meta app review for `instagram_business_content_publish`.

## Text to speech (Phase 3, T22)

`TtsProvider.synthesize({ text, locale, providerVoiceId })` returns encoded audio (WAV or MP3),
its duration, the model and the cost. Before every call the worker checks the voice with
`evaluateVoice` (approved, not revoked, license in force with commercial use, consent proof when
it imitates a real person; rule 5), and billable calls go through the same spend gate as the LLM.

- `TTS_PROVIDER=disabled` (default): renders are refused before any narration.
- `TTS_PROVIDER=fake` (local only): a 220 Hz tone per word at 2.6 words/s, so the whole render
  pipeline can be tested without a provider. It is obviously not a human voice.
- No real provider adapter exists. Before adding one, check the provider's current official docs
  for: commercial-use terms for the voices, data retention, Spanish (es-ES / es-419) quality, and
  pricing; register each voice with its license in "Derechos" and have a rights reviewer approve
  it.
