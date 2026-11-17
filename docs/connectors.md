# Connectors

All external providers sit behind interfaces in `packages/connectors`. The domain never imports a
vendor SDK directly.

| Interface           | Phase 1 implementation        | Status                       |
| ------------------- | ----------------------------- | ---------------------------- |
| `PublisherAdapter`  | `SimulatedPublisher`          | Implemented, contract-tested |
| `LlmProvider`       | none                          | Contract only (Phase 2)      |
| `TtsProvider`       | none                          | Contract only (Phase 3)      |
| `DiscoveryProvider` | none                          | Contract only (Phase 2)      |
| `SecretStore`       | `EnvSecretStore` (local only) | Implemented                  |

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
