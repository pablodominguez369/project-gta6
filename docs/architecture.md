# Architecture

Modular monolith with asynchronous jobs. Module boundaries are enforced by package dependencies so
services can be split later if usage requires it.

```text
Admin panel (Next.js on Vercel)
      |  server actions / route handlers (enqueue only)
      v
Supabase Postgres  <---- pg-boss queue ---->  Worker (Node, off Vercel)
  (RLS, audit)                                    |
Supabase Auth / Storage                     Connectors (simulated in Phase 1)
```

## Packages and dependency rule

| Package                   | Responsibility                                  | May depend on                                 |
| ------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `packages/domain`         | Entities, Zod schemas, errors, pure policies    | nothing internal                              |
| `packages/config`         | Typed environment loading                       | `domain`                                      |
| `packages/observability`  | Logger with redaction                           | `domain`                                      |
| `packages/db`             | Supabase clients, generated types, repositories | `domain`, `config`                            |
| `packages/jobs`           | `JobQueue`, pg-boss, publication orchestrator   | `domain`, `db`, `connectors`, `observability` |
| `packages/connectors`     | Provider interfaces and simulators              | `domain`                                      |
| `apps/web`, `apps/worker` | Composition only, no business rules             | any package                                   |

## Authentication

- Supabase Auth, email + password, sign-ups disabled. Keys: publishable (browser) and secret
  (server/worker only, bypasses RLS).
- `apps/web/proxy.ts` (Next 16 replacement for `middleware.ts`) refreshes the session with
  `@supabase/ssr` and redirects anonymous users to `/login`.
- `requireRole()` in pages and actions: no session → `/login`; missing role → HTTP 403.
- RLS remains the source of truth: a bypassed UI check still cannot read or write data.

## Phase 1 vertical slice

An admin creates a channel in Draft mode and enqueues a simulated publication. The worker processes
it with `SimulatedPublisher`, honours global and per-channel pause, de-duplicates by idempotency key,
reconciles ambiguous results before any retry, and writes every step to the audit log.

### Publication flow (T10)

```text
/admin/publications (admin, publisher)
   | insert publications(status=queued, idempotency_key from the form)   <- RLS, unique key
   v
dispatcher (worker, every 5 s)  -- outbox: queued | blocked past next_attempt_at | orphaned in_progress
   | enqueue publish.simulated, singletonKey = publication id (exclusive queue)
   v
processPublication (under a per-channel advisory lock)
   1. gates: global pause, channel pause, platform must be "simulated"   -> blocked / failed
   2. reconcile_required? ask the platform first; found -> succeeded (no new post)
   3. frequency limits in the channel time zone                          -> blocked
   4. commit reconcile_required = true, then publish
      ok -> succeeded | timeout -> ambiguous + retry (reconciles) | 429/503 -> retry
      expired credential / invalid / forbidden -> failed (no retry)
   5. no attempts left and still ambiguous -> stays ambiguous + audit
      publications.reconciliation_required (runbooks/ambiguous-publication.md)
```

Code: `packages/jobs/src/publishing/`. The worker writes publication state over a direct Postgres
connection (`DATABASE_URL`) so the status change and the advisory lock share the same database;
like the secret key it bypasses RLS and only exists in the worker. Ambiguous rows are never picked
up automatically after the last attempt: an operator decides (rule 7).

## Editorial research (Phase 2)

```text
allowlisted feeds / manual URL -> sources (metadata + 300-char excerpt)
  -> opportunity.build: same story within 72 h (title trigram similarity >= 0.5) -> opportunity
  -> assessment: confirmed (official source) | reported (2+ independent reliable) | rumor
     + risk flags (leak -> auto-discarded, spoiler, single_source, unknown_provenance)
     + score 0-100 (freshness, coverage, trust; rumors penalised) + expiry 72 h after latest source
  -> editor shortlists / accepts / discards with a reason
```

Code: `packages/domain/src/opportunity.ts` (pure rules) and `packages/jobs/src/opportunities/`.
The score orders what to look at first; only the certainty says what a script may state.

### Claims with evidence (T15)

An editor writes each claim on the opportunity page with its certainty, a "sensitive" flag and
the sources behind it. `evaluateClaimEvidence` (`packages/domain/src/claim-evidence.ts`) decides
whether the sources back the declared certainty:

- `confirmed` needs an official/primary source; `reported` needs two independent reliable
  publishers (or an official source).
- A sensitive claim (dates, prices, people, health...) needs an official source or two reliable
  publishers whatever its certainty; a single non-official source raises `sensitive_single_source`.
- Factual claims need a dated source; rumors, speculation and opinion are always labelled.

The web action refuses claims that fail the check, and a second editor (never the author) verifies
them. Because editors could write claims through the API directly, the script QA (T17) runs the
same check again on every claim a script cites; the database also refuses factual claims without a
source and drops a verification when the claim or its sources change.

### Scripts and automatic QA (T17)

A script belongs to an accepted opportunity and is a list of lines (`hook`, `context`, `body`,
`cta`), each with its spoken text, on-screen text and the claims it relies on
(`scriptDraftSchema`, stored in `scripts.lines_json`). Editors can always write scripts by hand, so
the product works with the LLM switched off.

`runScriptQa` (`packages/domain/src/script.ts`) runs on every save and again when the script is sent
to review; the stored `qa_report` is informative only and never trusted. Errors block review:

- `context`/`body` lines without a claim, claims of another opportunity, claims whose sources do
  not back them, factual claims not verified by a second person;
- rumors, speculation or opinions used without saying so in the line;
- links in the text (links only come from recorded sources), quotes that are not in a cited
  claim, leak vocabulary, and a duration over the target (+10 %) or 60 s.

Spoilers, a missing hook and a script much shorter than the target are warnings.

### AI drafts (T17)

```text
editor clicks "Redactar con IA" -> script_requests (queued; one open request per opportunity)
  -> worker dispatcher (10 s) -> script.draft job
  -> only claims the QA accepts (evidence ok, factual ones verified) go into the prompt
  -> generateWithSpendGate (blocked while limits are 0; rechecked every hour)
  -> scriptDraftSchema + runScriptQa -> new draft version (prompt_version, llm_usage_id)
```

The prompt (`packages/jobs/src/scripts/script-prompt.ts`, versioned) carries claim ids and texts
written by editors, never raw source excerpts, and tells the model to treat them as data. The
draft is attributed to the editor who asked for it, so that editor cannot approve it. Rate limits,
provider outages and timeouts leave the request blocked for 15 minutes; a refusal or an invalid
answer fails it.

### Script approvals (T19)

An editor or admin who did not write the script reviews it on `/admin/scripts/[id]` and approves
it, asks for changes or rejects it (the last two need a reason). Each decision is an append-only
`approvals` row; a database trigger checks that the script is in review and the reviewer is not
the author, then applies the decision to the script in the same transaction. Before approving,
the web action runs `runScriptQa` again with the current claims: if a cited claim changed (and so
lost its verification) after the script was sent to review, the approval is refused and the
reviewer is asked to request changes. Approval only marks the script as ready; nothing is
produced or published yet.

### Editorial calendar (T18)

An admin sets weekly windows per channel in `/admin/calendar` (`schedule_rules`, one per channel,
in the rule's own IANA time zone). `proposeSlots` (`packages/domain/src/calendar.ts`) turns them
into proposed slots for the next 7 days. Each slot is in the future, and the slots respect the
channel's posts per local day and minimum gap, counting publications already scheduled or
published. Nothing is reserved or published.

Daylight saving time is resolved with the IANA database, never with fixed offsets:

- A window keeps its local hour across changes: 10:00 stays 10:00, at 09:00 UTC in winter and
  08:00 UTC in summer.
- A local time that does not exist is skipped. For example, 02:00-02:59 on 2026-03-29 in Madrid.
- A local time that happens twice is proposed once, at its first occurrence. For example,
  02:00-02:59 on 2026-10-25 in Madrid.

## Media factory (Phase 3)

### Rights registry (T20)

Every image, clip, music track, font or voice used in a video is an `asset` with an origin and a
rights status (`packages/domain/src/rights.ts`, `evaluateAssetRights`). The check fails closed:

- only `original` (own work or AI output with commercial rights) and `cleared` (with a license)
  are usable; `unknown`, `requires_permission`, `restricted`, `expired` and `disputed` block;
- own gameplay captures, official material and stock always need a license, even if marked
  otherwise (a public trailer is not a license, rule 3);
- a license must be in force at the time of use, cover the platform, and allow commercial use
  (every channel is treated as commercial).

The render worker runs the check before rendering, and the publisher runs it again before
publishing, with fresh data, so a license that expires or an asset that gets disputed in
between still blocks.

### Rights screen (T21)

`/admin/assets` ("Derechos"). Editors, rights reviewers and admins upload files: the server
checks type and size and returns a one-time signed upload URL for a random `assets/<uuid>.<ext>`
path, the browser uploads straight to the private `media` bucket (large files never pass through
a Vercel function), then the server reads the stored size and type from Storage and registers
the asset. The SHA-256 is computed in the browser; the render worker recomputes it before use and
blocks the asset on a mismatch. Rights reviewers and admins record licenses and decide each
asset's status; the page shows whether each asset can be used and why not. Files are opened
through `/admin/assets/<id>/file`, which redirects to a 60-second signed URL.

### Video projects and storyboard (T23)

An editor turns an approved script into a `media_project` (`/admin/media`, "Vídeos"): one voice,
an optional music track, the own brand text, target platforms and a background per scene. The
selects only offer assets and voices usable right now; the worker checks again before rendering.

`packages/domain/src/storyboard.ts` is pure and shared by the preview and the worker:

- `buildStoryboard` lays the lines end to end with the narration length of each line (the TTS
  result in the worker, an estimate in the preview) plus its pause.
- `buildCaptions` wraps each line within the safe area (1080x1920, text between y=250 and y=1500,
  90 px side margins) in cues of at most two lines, timed by characters within the line's voice.
- `findOverflowingText` flags headlines that would need more than three lines.
- `buildAss` writes the subtitles file (captions, headline per scene, own brand and the
  synthetic-voice disclosure) for FFmpeg/libass; ASS override braces in the text are removed.

Clients only edit drafts and queue them (`guard_media_project`); `renders` are written by the
worker only.

### Render worker (T24)

`media.render` jobs (one per project, no queue retries) come from an outbox dispatcher over
`media_projects` (queued and due, or `rendering` for more than 30 minutes). `renderProject` in
`packages/jobs/src/media/render-project.ts` fails closed, in this order:

1. Claims the project atomically (`update ... returning`); a second run is skipped. At most 10
   claims per project, so a crashing render cannot loop.
2. The script must still be approved.
3. Rights gate (`evaluateRightsGate`) for every asset, for commercial use, with and without each
   target platform. Anything not `original`/`cleared` with a license in force blocks (rule 3).
4. Voice check (`evaluateVoice`, rule 5); the active TTS provider must be the voice's provider.
   `TTS_PROVIDER=disabled` blocks.
5. Downloads every asset from the private bucket and compares its SHA-256 with the registry.
6. Narration line by line through `synthesizeWithSpendGate` (same `llm_usage` table and limits
   as the LLM, purpose `tts.synthesize`). Spend limit, rate limit or an unknown outcome puts the
   project back in the queue with `next_attempt_at`; other errors fail it.
7. Storyboard, ASS subtitles with the closing card (attributions plus the independence notice)
   and the FFmpeg run (`buildRenderArgs`: argument array, never a shell). The master is
   1080x1920, 30 fps, H.264 high/yuv420p, AAC 48 kHz, loudness normalised to -14 LUFS, fast start.
8. Technical QC (`evaluateRenderQc`): size, codecs, audio present and not silent, duration within
   500 ms and under 62.5 s, file size, no black interval over 1 s, no overflowing text. A failed
   QC stores the render but marks the project `failed` with the reasons.
9. Uploads `renders/<project>/v<N>/master.mp4` and `manifest.json` (never overwriting) and
   inserts the `renders` row. The manifest records the template, FFmpeg version and arguments,
   subtitle hash, script version, voice and per-line audio hashes, and every source hash with
   its rights status and license, so a render can be reproduced and audited.

Only the master is rendered. Per-platform encodes wait until each platform's current upload specs
are checked (rule 2, Phase 4). The worker image installs `ffmpeg` and `fonts-dejavu-core`.

## Decisions

- [ADR 0001](adr/0001-monolith-nextjs-supabase.md): Next.js + Supabase modular monolith
- [ADR 0002](adr/0002-pg-boss-job-queue.md): pg-boss as the initial job queue
- [ADR 0003](adr/0003-secret-references.md): secrets are referenced, never stored

Connectors and the publisher contract: [connectors.md](connectors.md).
