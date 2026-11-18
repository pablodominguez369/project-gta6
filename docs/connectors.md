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

## Real platforms: capabilities pending verification

Nothing below is implemented. Every item must be checked against the current official
documentation (scopes, app review/audit, quotas, eligibility, required UX) before an adapter is
written, and recorded in the adapter's `capabilities.verifiedAgainstDocsAt` and `docsUrls`.

| Platform        | What the spec expects (unverified)                                         | Manual fallback |
| --------------- | -------------------------------------------------------------------------- | --------------- |
| YouTube Shorts  | Data API v3 `videos.insert`, scope `youtube.upload`, `status.publishAt`    | Yes             |
| Instagram Reels | Content Publishing (container + publish), permissions depend on login type | Yes             |
| TikTok          | Content Posting API Direct Post, `video.publish`, audit for public posts   | Yes             |

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
