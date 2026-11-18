import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildAss,
  buildEndCard,
  buildStoryboard,
  evaluateRenderQc,
  evaluateRightsGate,
  evaluateVoice,
  findOverflowingText,
  RENDER_QC_MESSAGES,
  RIGHTS_ISSUE_MESSAGES,
  scriptDraftSchema,
  videoDurationMs,
  VOICE_ISSUE_MESSAGES,
  type AssetOrigin,
  type ErrorCode,
  type Platform,
  type RightsAsset,
  type RightsLicense,
  type RightsStatus,
} from "@gta6/domain";
import type pg from "pg";

import { ffmpegVersion, measureRender, runProcess } from "./ffmpeg";
import type { MediaStore } from "./media-store";
import { buildRenderArgs, type PlanBackground } from "./render-plan";
import { synthesizeWithSpendGate, type TtsGateDeps } from "./synthesize-with-spend-gate";

export const TEMPLATE_VERSION = "vertical-news-v1";
export const CAPTION_FONT = "DejaVu Sans";
export const DISCLOSURE_TEXT = "Voz generada con IA";
/** A rendering project untouched for this long is assumed orphaned (worker crash). */
export const STALE_RENDERING_MINUTES = 30;
export const MAX_RENDER_ATTEMPTS = 5;
/** Hard cap on claims (matches the table check), so a crashing render cannot loop forever. */
export const MAX_RENDER_CLAIMS = 10;

/** Temporary problems: the project goes back to the queue and is tried again later. */
const RETRY_AFTER_MS: Partial<Record<ErrorCode, number>> = {
  SPEND_LIMIT_REACHED: 60 * 60_000,
  RATE_LIMITED: 15 * 60_000,
  EXTERNAL_UNAVAILABLE: 15 * 60_000,
  AMBIGUOUS_EXTERNAL_STATE: 15 * 60_000,
};

const RETRY_MESSAGES: Partial<Record<ErrorCode, string>> = {
  SPEND_LIMIT_REACHED: "Límite de gasto alcanzado (o a 0): se reintentará cuando haya margen.",
  RATE_LIMITED: "El proveedor de voz pide esperar: se reintentará.",
  EXTERNAL_UNAVAILABLE: "El proveedor de voz no responde: se reintentará.",
  AMBIGUOUS_EXTERNAL_STATE: "El proveedor de voz no respondió a tiempo: se reintentará.",
};

export interface RenderDeps extends TtsGateDeps {
  readonly pool: pg.Pool;
  readonly media: MediaStore;
  readonly binaries: { readonly ffmpeg: string; readonly ffprobe: string };
  readonly fontsDir: string;
}

export type RenderOutcome =
  | { readonly kind: "rendered"; readonly renderId: string; readonly qcPassed: boolean }
  | { readonly kind: "skipped" }
  | { readonly kind: "retry"; readonly code: ErrorCode }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "failed"; readonly code: ErrorCode; readonly reason: string };

interface ProjectRow {
  id: string;
  script_id: string;
  voice_id: string | null;
  music_asset_id: string | null;
  target_platforms: Platform[];
  brand: string;
  attempts: number;
}

interface AssetRow {
  id: string;
  title: string;
  owner: string;
  kind: string;
  origin: AssetOrigin;
  rights_status: RightsStatus;
  attribution: string;
  storage_path: string;
  content_hash: string;
  mime_type: string;
  license_id: string | null;
  license: LicenseJson | null;
}

interface LicenseJson {
  id: string;
  allowed_platforms: Platform[];
  commercial_allowed: boolean;
  valid_from: string | null;
  expires_at: string | null;
}

interface VoiceRow {
  id: string;
  provider: string;
  provider_voice_id: string;
  locale: "es-ES" | "es-419";
  imitates_real_person: boolean;
  consent_proof_path: string | null;
  disclosure_required: boolean;
  approved_at: string | null;
  revoked_at: string | null;
  license: LicenseJson | null;
}

const toLicense = (l: LicenseJson | null): RightsLicense | null =>
  l
    ? {
        id: l.id,
        allowedPlatforms: l.allowed_platforms,
        commercialAllowed: l.commercial_allowed,
        validFrom: l.valid_from ? new Date(l.valid_from) : null,
        expiresAt: l.expires_at ? new Date(l.expires_at) : null,
      }
    : null;

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

const LICENSE_JSON = `case when l.id is null then null else json_build_object(
  'id', l.id, 'allowed_platforms', l.allowed_platforms, 'commercial_allowed', l.commercial_allowed,
  'valid_from', l.valid_from, 'expires_at', l.expires_at) end`;

/**
 * Renders one queued project. Safe to run twice for the same id: the project is claimed
 * atomically. Fails closed: rights, voice, file integrity and the spend gate are all checked
 * before anything is produced, and every render is stored with its QC report and manifest.
 */
export async function renderProject(deps: RenderDeps, projectId: string): Promise<RenderOutcome> {
  const { pool, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const claimed = await pool.query<ProjectRow>(
    `update public.media_projects
        set status = 'rendering', attempts = attempts + 1, status_reason = null
      where id = $1
        and attempts < $3
        and ((status = 'queued' and coalesce(next_attempt_at, now()) <= now())
             or (status = 'rendering' and updated_at < now() - make_interval(mins => $2)))
      returning id, script_id, voice_id, music_asset_id, target_platforms, brand, attempts`,
    [projectId, STALE_RENDERING_MINUTES, MAX_RENDER_CLAIMS],
  );
  const project = claimed.rows[0];
  if (!project) return { kind: "skipped" };
  const log = logger.child({ projectId });

  const finish = async (
    status: "blocked" | "failed" | "rendered",
    reason: string | null,
  ): Promise<void> => {
    await pool.query(
      "update public.media_projects set status = $2, status_reason = $3, next_attempt_at = null where id = $1",
      [projectId, status, reason?.slice(0, 1000) ?? null],
    );
  };
  const block = async (reason: string): Promise<RenderOutcome> => {
    await finish("blocked", reason);
    log.warn({ reason }, "render blocked");
    return { kind: "blocked", reason };
  };
  const fail = async (code: ErrorCode, reason: string): Promise<RenderOutcome> => {
    await finish("failed", reason);
    log.error({ errorCode: code }, "render failed");
    return { kind: "failed", code, reason };
  };

  // 1. The script must still be approved.
  const { rows: scripts } = await pool.query<{
    status: string;
    version: number;
    lines_json: unknown;
    cta: string | null;
  }>("select status, version, lines_json, cta from public.scripts where id = $1", [
    project.script_id,
  ]);
  const script = scripts[0];
  if (script?.status !== "approved") return block("El guion ya no está aprobado.");
  const draft = scriptDraftSchema.safeParse({ lines: script.lines_json, cta: script.cta ?? "" });
  if (!draft.success) return fail("VALIDATION_FAILED", "El guion no es válido.");

  // 2. Rights of every asset, for every target platform and for commercial use (rule 3).
  const { rows: assets } = await pool.query<AssetRow & { scene_index: number | null }>(
    `select a.id, a.title, a.owner, a.kind, a.origin, a.rights_status, a.attribution,
            a.storage_path, a.content_hash, a.mime_type, a.license_id, ${LICENSE_JSON} as license,
            s.scene_index
       from public.assets a
       left join public.licenses l on l.id = a.license_id
       left join public.media_project_scenes s on s.asset_id = a.id and s.project_id = $1
      where a.id in (select asset_id from public.media_project_scenes where project_id = $1)
         or a.id = $2`,
    [projectId, project.music_asset_id],
  );
  const rightsAssets: RightsAsset[] = assets.map((a) => ({
    id: a.id,
    origin: a.origin,
    rightsStatus: a.rights_status,
    license: toLicense(a.license),
  }));
  const blockedTitles = new Map<string, string>();
  for (const platform of [null, ...project.target_platforms]) {
    const gate = evaluateRightsGate(rightsAssets, { platform, commercial: true, at: now() });
    for (const blocked of gate.blocked) {
      const asset = assets.find((a) => a.id === blocked.assetId);
      blockedTitles.set(
        blocked.assetId,
        `«${asset?.title ?? blocked.assetId}»${platform ? ` (${platform})` : ""}: ${blocked.issues.map((i) => RIGHTS_ISSUE_MESSAGES[i]).join(" ")}`,
      );
    }
  }
  if (blockedTitles.size > 0) {
    return block(`Derechos: ${[...blockedTitles.values()].join(" ")}`);
  }

  // 3. The voice (rule 5).
  if (!project.voice_id) return block("Falta elegir la voz.");
  const { rows: voices } = await pool.query<VoiceRow>(
    `select v.id, v.provider, v.provider_voice_id, v.locale, v.imitates_real_person,
            v.consent_proof_path, v.disclosure_required, v.approved_at, v.revoked_at,
            ${LICENSE_JSON} as license
       from public.voices v left join public.licenses l on l.id = v.license_id
      where v.id = $1`,
    [project.voice_id],
  );
  const voice = voices[0];
  if (!voice) return block("La voz ya no existe.");
  const voiceCheck = evaluateVoice(
    {
      id: voice.id,
      provider: voice.provider,
      approved: voice.approved_at !== null,
      revoked: voice.revoked_at !== null,
      imitatesRealPerson: voice.imitates_real_person,
      hasConsentProof: voice.consent_proof_path !== null,
      license: toLicense(voice.license),
    },
    now(),
  );
  if (!voiceCheck.usable) {
    return block(`Voz: ${voiceCheck.issues.map((i) => VOICE_ISSUE_MESSAGES[i]).join(" ")}`);
  }
  if (deps.tts.name === "disabled") {
    return block("No hay proveedor de voz configurado: el vídeo no se puede narrar.");
  }
  if (deps.tts.name !== voice.provider) {
    return block(
      `La voz es de «${voice.provider}» pero el proveedor activo es «${deps.tts.name}».`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "render-"));
  try {
    // 4. Files: download and verify each asset's hash before use.
    const sources: {
      assetId: string;
      path: string;
      sha256: string;
      rightsStatus: string;
      licenseId: string | null;
    }[] = [];
    const localFiles = new Map<string, PlanBackground>();
    for (const [index, asset] of assets.entries()) {
      const body = await deps.media.download(asset.storage_path);
      if (!body)
        return await fail("EXTERNAL_UNAVAILABLE", `No se pudo descargar «${asset.title}».`);
      const hash = sha256(body);
      if (hash !== asset.content_hash) {
        return await block(`El archivo de «${asset.title}» no coincide con el registrado.`);
      }
      const extension = asset.mime_type.split("/")[1]?.replace(/[^a-z0-9]/g, "") ?? "bin";
      const file = `asset_${String(index)}.${extension}`;
      await writeFile(join(dir, file), body);
      localFiles.set(asset.id, {
        file,
        kind: asset.mime_type.startsWith("video/") ? "video" : "image",
      });
      sources.push({
        assetId: asset.id,
        path: asset.storage_path,
        sha256: hash,
        rightsStatus: asset.rights_status,
        licenseId: asset.license_id,
      });
    }

    // 5. Narration, line by line, through the spend gate.
    const voiceFiles: string[] = [];
    const durations: number[] = [];
    const segments: { line: number; sha256: string; durationMs: number; model: string }[] = [];
    for (const [index, line] of draft.data.lines.entries()) {
      const spoken = await synthesizeWithSpendGate(deps, {
        text: line.voice,
        locale: voice.locale,
        providerVoiceId: voice.provider_voice_id,
      });
      if (!spoken.ok) {
        const code = spoken.error.code;
        const wait = RETRY_AFTER_MS[code];
        if (wait !== undefined && project.attempts < MAX_RENDER_ATTEMPTS) {
          await pool.query(
            `update public.media_projects
                set status = 'queued', status_reason = $2,
                    next_attempt_at = now() + make_interval(secs => $3)
              where id = $1`,
            [projectId, RETRY_MESSAGES[code] ?? null, wait / 1000],
          );
          log.warn({ errorCode: code }, "render postponed");
          return { kind: "retry", code };
        }
        return await fail(code, RETRY_MESSAGES[code] ?? "La voz no se pudo generar.");
      }
      const file = `voice_${String(index)}.${spoken.value.mimeType === "audio/wav" ? "wav" : "mp3"}`;
      await writeFile(join(dir, file), spoken.value.audio);
      voiceFiles.push(file);
      durations.push(spoken.value.durationMs);
      segments.push({
        line: index,
        sha256: sha256(spoken.value.audio),
        durationMs: spoken.value.durationMs,
        model: spoken.value.model,
      });
    }

    // 6. Storyboard, subtitles and the FFmpeg run.
    const backgroundIds = draft.data.lines.map(
      (_, index) => assets.find((a) => a.scene_index === index)?.id ?? null,
    );
    const storyboard = buildStoryboard(draft.data, durations, backgroundIds);
    const attributions = assets.map((a) => a.attribution || `${a.title}: ${a.owner}`);
    const ass = buildAss(storyboard, {
      font: CAPTION_FONT,
      brand: project.brand,
      disclosure: voice.disclosure_required ? DISCLOSURE_TEXT : null,
      endCard: buildEndCard(attributions),
    });
    await writeFile(join(dir, "subs.ass"), ass);
    const music = project.music_asset_id ? localFiles.get(project.music_asset_id) : undefined;
    const args = buildRenderArgs({
      storyboard,
      backgrounds: backgroundIds.map((assetId) =>
        assetId ? (localFiles.get(assetId) ?? null) : null,
      ),
      voiceFiles,
      musicFile: music?.file ?? null,
      assFile: "subs.ass",
      fontsDir: deps.fontsDir,
      output: "master.mp4",
    });
    const run = await runProcess(deps.binaries.ffmpeg, args, { cwd: dir });
    if (run.code !== 0) {
      log.error({ exitCode: run.code, stderrTail: run.stderr.slice(-500) }, "ffmpeg failed");
      return await fail("INTERNAL", "El montaje del vídeo ha fallado.");
    }

    // 7. Technical QC.
    const measured = await measureRender(join(dir, "master.mp4"), deps.binaries);
    if (!measured) return await fail("INTERNAL", "No se pudo analizar el vídeo.");
    const qc = evaluateRenderQc(measured, {
      durationMs: videoDurationMs(storyboard),
      overflowingScenes: findOverflowingText(storyboard),
    });

    // 8. Store the master and its manifest, then record the render.
    const output = await readFile(join(dir, "master.mp4"));
    const checksum = sha256(output);
    const { rows: versions } = await pool.query<{ next: number }>(
      "select coalesce(max(version), 0) + 1 as next from public.renders where project_id = $1",
      [projectId],
    );
    const version = versions[0]?.next ?? 1;
    const base = `renders/${projectId}/v${String(version)}`;
    const manifest = {
      template: TEMPLATE_VERSION,
      renderedAt: now().toISOString(),
      ffmpeg: await ffmpegVersion(deps.binaries.ffmpeg),
      args,
      subtitlesSha256: sha256(new TextEncoder().encode(ass)),
      script: { id: project.script_id, version: script.version },
      voice: {
        id: voice.id,
        provider: voice.provider,
        providerVoiceId: voice.provider_voice_id,
        disclosureRequired: voice.disclosure_required,
        segments,
      },
      sources,
      output: { path: `${base}/master.mp4`, sha256: checksum, sizeBytes: output.length },
      qc,
    };
    const uploadedVideo = await deps.media.upload(`${base}/master.mp4`, output, "video/mp4");
    const uploadedManifest = await deps.media.upload(
      `${base}/manifest.json`,
      new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      "application/json",
    );
    if (!uploadedVideo || !uploadedManifest) {
      return await fail("EXTERNAL_UNAVAILABLE", "No se pudo guardar el vídeo.");
    }
    const { rows: inserted } = await pool.query<{ id: string }>(
      `insert into public.renders
         (project_id, version, profile, storage_path, checksum, size_bytes, duration_ms, width,
          height, video_codec, audio_codec, qc_passed, qc_report, manifest, manifest_path,
          disclosure_required)
       values ($1, $2, 'master', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning id`,
      [
        projectId,
        version,
        `${base}/master.mp4`,
        checksum,
        output.length,
        measured.durationMs,
        measured.width,
        measured.height,
        measured.videoCodec,
        measured.audioCodec,
        qc.passed,
        JSON.stringify(qc),
        JSON.stringify(manifest),
        `${base}/manifest.json`,
        voice.disclosure_required,
      ],
    );
    const renderId = inserted[0]?.id ?? "";
    if (qc.passed) {
      await finish("rendered", null);
    } else {
      const failed = qc.checks.filter((c) => !c.ok).map((c) => RENDER_QC_MESSAGES[c.code]);
      await finish(
        "failed",
        `El control técnico no se ha superado. Debe cumplirse: ${failed.join(" ")}`,
      );
    }
    log.info({ renderId, version, qcPassed: qc.passed }, "render stored");
    return { kind: "rendered", renderId, qcPassed: qc.passed };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
