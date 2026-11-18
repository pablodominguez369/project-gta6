# ADR 0006: Platform metrics in fixed windows, compared with their uncertainty

- Status: accepted
- Date: 2026-11-18

## Context

Phase 5 adds metric ingestion, a performance panel, experiments and recommendations. The
specification (sections 4.5 and 10) requires that reports keep each platform's metrics apart, show
source, date, window, sample size and confidence, and never present a correlation as a cause or
declare a winner with an insufficient sample. The capabilities confirmed in
[docs/platforms.md](../platforms.md#analytics-phase-5) differ per platform: YouTube has counters and
an analytics report, TikTok only exposes counters for **public** videos, and Instagram has no OAuth
connection in this project yet.

## Decision

- **Snapshots in fixed windows.** One `metric_snapshots` row per publication and window
  (`1h`, `24h`, `7d`, `28d` after `published_at`). A unique key makes ingestion idempotent: a
  repeated run updates nothing that a person entered by hand, and never adds a second row.
- **Platform-native metrics.** Each row stores its platform, its source (`platform_api`, `manual`,
  `simulated`), the original metric names that filled it (`raw_metric_names`) and the definition
  version. Numbers from different platforms are never added up or ranked together; the panel
  compares inside one platform only.
- **Unknown is not zero.** A metric the platform did not return is `null`. Rates are computed only
  when both sides are known.
- **Uncertainty everywhere.** Group comparisons show the sample size and a confidence label:
  `insufficient` (fewer than 5 publications in a group), `low`, or `moderate`. Without a controlled
  experiment the label is never higher than `moderate`, and the text says "correlation". Rates
  (interactions per view) carry a 95 % Wilson interval.
- **Experiments with one variable** (`hook`, `duration`, `time_slot`, `topic`) and a control arm.
  A variant wins only if every arm reaches the minimum sample (default 10 publications) and the
  95 % interval of the rate difference (Newcombe) excludes zero; otherwise the result is
  `inconclusive`.
- **Recommendations are suggestions.** Nothing changes calendar, limits, voice, claims, rights or
  topics automatically in Phase 5 (rule 8). A later phase may allow low-risk automatic changes
  within limits, behind an explicit switch.
- **Aggregates only.** No commenter data, no per-viewer data.
- **Minimal read scopes**, requested on (re)connection: `yt-analytics.readonly` for YouTube
  (on top of `youtube.readonly`) and `video.list` for TikTok. Instagram metrics are entered by
  hand until an Instagram connection exists.

## Consequences

- While uploads stay private (ADR 0005), real metrics will be close to zero, and TikTok returns
  nothing for private videos: the simulated source and manual entry are the useful paths.
- Adding a metric or a window is a domain change plus a migration; metric definitions that change
  on a platform's side are recorded by bumping the definition version, so old and new numbers are
  not mixed silently.
