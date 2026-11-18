import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FakeTtsProvider, SimulatedPublisher } from "@gta6/connectors";
import { DomainError } from "@gta6/domain";
import { createLogger } from "@gta6/observability";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../../__tests__/test-db";
import { PgLlmUsageStore } from "../../llm/llm-usage-store";
import { PgSimulatedRemoteStore } from "../../publishing/pg-simulated-remote-store";
import { processPublication } from "../../publishing/process-publication";
import { PgPublicationStore } from "../../publishing/publication-store";
import { dispatchMediaRenders } from "../dispatcher";
import { runProcess } from "../ffmpeg";
import { MemoryMediaStore } from "../media-store";
import { renderProject, type RenderDeps } from "../render-project";

// Needs the local database plus ffmpeg/ffprobe with libass and the DejaVu fonts.
const FONTS_DIR = process.env.RENDER_FONTS_DIR ?? "/usr/share/fonts/truetype/dejavu";
const logger = createLogger({ name: "render-project-it", level: "fatal" });
const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
const run = randomUUID();
const reviewerId = randomUUID();
let opportunityId = "";
let scriptId = "";
let voiceId = "";
let backgroundPng = new Uint8Array();
let workDir = "";
const assetIds: string[] = [];
const projectIds: string[] = [];
let channelId = "";

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

const LINES = [
  {
    kind: "hook",
    voice: "Hay noticias del juego",
    on_screen: "Noticias",
    claim_refs: [],
    pause_ms: 0,
    visual_note: "",
  },
  {
    kind: "cta",
    voice: "Te lo seguiremos contando",
    on_screen: "",
    claim_refs: [],
    pause_ms: 200,
    visual_note: "",
  },
];

async function setLimits(daily: number, monthly: number): Promise<void> {
  await pool.query(
    "update public.system_controls set daily_spend_limit_eur = $1, monthly_spend_limit_eur = $2",
    [daily, monthly],
  );
}

/** Registers an image asset and marks it with the given rights status, as a reviewer would. */
async function newAsset(media: MemoryMediaStore, rightsStatus: "original" | "disputed") {
  const path = `assets/it-${run}/${randomUUID()}.png`;
  await media.upload(path, backgroundPng, "image/png");
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.assets (kind, origin, title, owner, storage_path, content_hash, mime_type,
                                size_bytes, attribution)
     values ('image', 'original_work', 'Fondo propio', 'Canal', $1, $2, 'image/png', $3,
             'Fondo: Canal')
     returning id`,
    [path, sha256(backgroundPng), backgroundPng.length],
  );
  const id = rows[0]?.id ?? "";
  await pool.query(
    `update public.assets set rights_status = $2, reviewed_by = $3, reviewed_at = now()
      where id = $1`,
    [id, rightsStatus, reviewerId],
  );
  assetIds.push(id);
  return { id, path };
}

async function newProject(assetId: string | null, voice: string | null = voiceId) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.media_projects (script_id, voice_id, brand, status)
     values ($1, $2, 'Canal IT', 'queued') returning id`,
    [scriptId, voice],
  );
  const id = rows[0]?.id ?? "";
  projectIds.push(id);
  if (assetId) {
    await pool.query(
      "insert into public.media_project_scenes (project_id, scene_index, asset_id) values ($1, 0, $2)",
      [id, assetId],
    );
  }
  return id;
}

async function projectRow(id: string) {
  const { rows } = await pool.query<{
    status: string;
    status_reason: string | null;
    next_attempt_at: Date | null;
  }>("select status, status_reason, next_attempt_at from public.media_projects where id = $1", [
    id,
  ]);
  return rows[0];
}

function deps(media: MemoryMediaStore, tts = new FakeTtsProvider()): RenderDeps {
  return {
    pool,
    tts,
    store: new PgLlmUsageStore(pool),
    logger,
    media,
    binaries: { ffmpeg: "ffmpeg", ffprobe: "ffprobe" },
    fontsDir: FONTS_DIR,
  };
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "render-project-it-"));
  const png = await runProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x2a9d8f:s=720x1280",
      "-frames:v",
      "1",
      "bg.png",
    ],
    { cwd: workDir },
  );
  if (png.code !== 0) throw new Error("ffmpeg could not create the test image");
  backgroundPng = new Uint8Array(await readFile(join(workDir, "bg.png")));

  await pool.query(
    "insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')",
    [reviewerId, `render-${run}@example.test`],
  );
  const opportunity = await pool.query<{ id: string }>(
    "insert into public.opportunities (topic, status, decision_reason) values ($1, 'accepted', 'it') returning id",
    [`Render ${run}`],
  );
  opportunityId = opportunity.rows[0]?.id ?? "";
  const script = await pool.query<{ id: string }>(
    `insert into public.scripts (opportunity_id, version, status, lines_json, cta)
     values ($1, 1, 'approved', $2, '') returning id`,
    [opportunityId, JSON.stringify(LINES)],
  );
  scriptId = script.rows[0]?.id ?? "";
  const voice = await pool.query<{ id: string }>(
    `insert into public.voices (provider, provider_voice_id, display_name, approved_at, approved_by)
     values ('fake', $1, 'Voz de prueba', now(), $2) returning id`,
    [`it-${run}`, reviewerId],
  );
  voiceId = voice.rows[0]?.id ?? "";
});

beforeEach(async () => {
  await setLimits(0, 0);
});

afterAll(async () => {
  await setLimits(0, 0);
  if (channelId) {
    await pool.query(
      `delete from public.simulated_platform_posts where idempotency_key in
         (select idempotency_key from public.publications where channel_id = $1)`,
      [channelId],
    );
    await pool.query("delete from public.publications where channel_id = $1", [channelId]);
    await pool.query("delete from public.channels where id = $1", [channelId]);
  }
  await pool.query("delete from public.renders where project_id = any($1)", [projectIds]);
  await pool.query("delete from public.media_project_scenes where project_id = any($1)", [
    projectIds,
  ]);
  await pool.query("delete from public.media_projects where id = any($1)", [projectIds]);
  await pool.query("delete from public.assets where id = any($1)", [assetIds]);
  await pool.query("delete from public.voices where id = $1", [voiceId]);
  await pool.query("delete from public.scripts where id = $1", [scriptId]);
  await pool.query("delete from public.opportunities where id = $1", [opportunityId]);
  await pool.query("delete from auth.users where id = $1", [reviewerId]);
  await pool.end();
  await rm(workDir, { recursive: true, force: true });
});

describe("renderProject", () => {
  it("renders, stores the master and manifest, and passes QC", async () => {
    await setLimits(5, 50);
    const media = new MemoryMediaStore();
    const asset = await newAsset(media, "original");
    const id = await newProject(asset.id);

    const outcome = await renderProject(deps(media), id);

    expect(outcome).toMatchObject({ kind: "rendered", qcPassed: true });
    expect((await projectRow(id))?.status).toBe("rendered");
    const { rows } = await pool.query<{
      storage_path: string;
      checksum: string;
      width: number;
      height: number;
      manifest: { sources: { sha256: string }[]; template: string };
      disclosure_required: boolean;
    }>(
      "select storage_path, checksum, width, height, manifest, disclosure_required from public.renders where project_id = $1",
      [id],
    );
    const render = rows[0];
    expect(render?.storage_path).toBe(`renders/${id}/v1/master.mp4`);
    expect(render?.width).toBe(1080);
    expect(render?.height).toBe(1920);
    expect(render?.disclosure_required).toBe(true);
    expect(render?.manifest.template).toBe("vertical-news-v1");
    expect(render?.manifest.sources[0]?.sha256).toBe(sha256(backgroundPng));
    const stored = media.files.get(`renders/${id}/v1/master.mp4`);
    expect(stored && sha256(stored.body)).toBe(render?.checksum);
    expect(media.files.has(`renders/${id}/v1/manifest.json`)).toBe(true);

    // Narration was metered against the shared AI budget.
    const usage = await pool.query<{ n: number }>(
      "select count(*)::int as n from public.llm_usage where purpose = 'tts.synthesize' and created_at > now() - interval '5 minutes'",
    );
    expect(usage.rows[0]?.n).toBeGreaterThanOrEqual(LINES.length);
  });

  it("is claimed once: a second run is skipped", async () => {
    await setLimits(5, 50);
    const media = new MemoryMediaStore();
    const asset = await newAsset(media, "original");
    const id = await newProject(asset.id);
    await renderProject(deps(media), id);
    expect(await renderProject(deps(media), id)).toEqual({ kind: "skipped" });
  });

  it("blocks an asset whose rights are disputed", async () => {
    await setLimits(5, 50);
    const media = new MemoryMediaStore();
    const asset = await newAsset(media, "disputed");
    const id = await newProject(asset.id);
    const tts = new FakeTtsProvider();

    const outcome = await renderProject(deps(media, tts), id);

    expect(outcome.kind).toBe("blocked");
    const row = await projectRow(id);
    expect(row?.status).toBe("blocked");
    expect(row?.status_reason).toContain("Derechos");
    expect(tts.calls).toHaveLength(0);
  });

  it("blocks a file that does not match its registered hash", async () => {
    await setLimits(5, 50);
    const media = new MemoryMediaStore();
    const asset = await newAsset(media, "original");
    media.files.set(asset.path, { body: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    const id = await newProject(asset.id);

    const outcome = await renderProject(deps(media), id);

    expect(outcome.kind).toBe("blocked");
    expect((await projectRow(id))?.status_reason).toContain("no coincide");
  });

  it("blocks when the voice is no longer approved", async () => {
    await setLimits(5, 50);
    const media = new MemoryMediaStore();
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.voices (provider, provider_voice_id, display_name)
       values ('fake', $1, 'Sin aprobar') returning id`,
      [`it-unapproved-${run}`],
    );
    const unapproved = rows[0]?.id ?? "";
    const id = await newProject(null, unapproved);

    const outcome = await renderProject(deps(media), id);

    expect(outcome.kind).toBe("blocked");
    expect((await projectRow(id))?.status_reason).toContain("Voz");
    await pool.query("delete from public.media_projects where id = $1", [id]);
    projectIds.splice(projectIds.indexOf(id), 1);
    await pool.query("delete from public.voices where id = $1", [unapproved]);
  });

  it("goes back to the queue when the spend limit is 0, and is not dispatched early", async () => {
    const media = new MemoryMediaStore();
    const id = await newProject(null);

    const outcome = await renderProject(deps(media), id);

    expect(outcome).toEqual({ kind: "retry", code: "SPEND_LIMIT_REACHED" });
    const row = await projectRow(id);
    expect(row?.status).toBe("queued");
    expect(row?.next_attempt_at?.getTime()).toBeGreaterThan(Date.now());
    const enqueued: string[] = [];
    await dispatchMediaRenders(pool, {
      enqueue: (_name: string, data: object) => {
        enqueued.push((data as { projectId: string }).projectId);
        return Promise.resolve("job");
      },
    } as unknown as Parameters<typeof dispatchMediaRenders>[1]);
    expect(enqueued).not.toContain(id);
  });

  it("fails without retrying when the provider error is not temporary", async () => {
    await setLimits(5, 50);
    const media = new MemoryMediaStore();
    const id = await newProject(null);
    const tts = new FakeTtsProvider(new DomainError("CREDENTIAL_EXPIRED", "bad key"));

    const outcome = await renderProject(deps(media, tts), id);

    expect(outcome.kind).toBe("failed");
    expect((await projectRow(id))?.status).toBe("failed");
  });
});

describe("publishing a render", () => {
  async function publicationFor(renderId: string, syntheticMedia: boolean): Promise<string> {
    if (!channelId) {
      const channel = await pool.query<{ id: string }>(
        `insert into public.channels (platform, display_name, max_posts_per_day,
                                      min_minutes_between_posts)
         values ('simulated', $1, 50, 0) returning id`,
        [`Render IT ${run}`],
      );
      channelId = channel.rows[0]?.id ?? "";
    }
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.publications (channel_id, idempotency_key, payload_json, render_id)
       values ($1, $2, $3, $4) returning id`,
      [
        channelId,
        `it-render-${randomUUID()}`,
        JSON.stringify({ title: "Vídeo", description: "", mediaRef: "renders/x", syntheticMedia }),
        renderId,
      ],
    );
    return rows[0]?.id ?? "";
  }

  const publish = (publicationId: string) =>
    processPublication(
      {
        store: new PgPublicationStore(pool),
        publisher: new SimulatedPublisher({ store: new PgSimulatedRemoteStore(pool) }),
        logger,
      },
      { publicationId, attempt: 1, maxAttempts: 4 },
    );

  it("publishes a valid render and blocks it once an asset's rights are disputed", async () => {
    await setLimits(5, 50);
    const media = new MemoryMediaStore();
    const asset = await newAsset(media, "original");
    const outcome = await renderProject(deps(media), await newProject(asset.id));
    if (outcome.kind !== "rendered") throw new Error(`render failed: ${outcome.kind}`);

    expect(await publish(await publicationFor(outcome.renderId, true))).toEqual({
      kind: "succeeded",
      via: "publish",
    });
    // The synthetic voice must be declared.
    expect(await publish(await publicationFor(outcome.renderId, false))).toEqual({
      kind: "failed",
      code: "RIGHTS_BLOCKED",
    });

    await pool.query("update public.assets set rights_status = 'disputed' where id = $1", [
      asset.id,
    ]);
    const blocked = await publicationFor(outcome.renderId, true);
    expect(await publish(blocked)).toEqual({ kind: "failed", code: "RIGHTS_BLOCKED" });
    const { rows } = await pool.query<{ status: string; error_code: string }>(
      "select status, error_code from public.publications where id = $1",
      [blocked],
    );
    expect(rows[0]).toEqual({ status: "failed", error_code: "RIGHTS_BLOCKED" });
  });
});
