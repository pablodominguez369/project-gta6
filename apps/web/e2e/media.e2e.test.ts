import { randomUUID } from "node:crypto";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  baseUrl,
  createTestUser,
  deleteTestUser,
  ensureSentinelAdmin,
  signIn,
  type TestUser,
} from "./support";

let browser: Browser;
let editor: TestUser;
let reviewer: TestUser;
let scriptId = "";
let usableAssetId = "";
let blockedAssetId = "";
let voiceId = "";
const run = randomUUID();

async function insertAsset(title: string, hashChar: string): Promise<string> {
  const { data, error } = await adminClient
    .from("assets")
    .insert({
      kind: "image",
      origin: "original_work",
      title,
      owner: "Equipo",
      storage_path: `assets/${randomUUID()}.png`,
      content_hash: hashChar.repeat(64),
      mime_type: "image/png",
      size_bytes: 10,
    })
    .select("id")
    .single();
  if (error) throw new Error(`asset insert failed: ${error.code}`);
  return String(data.id);
}

beforeAll(async () => {
  await ensureSentinelAdmin();
  [editor, reviewer] = await Promise.all([
    createTestUser(["editor"]),
    createTestUser(["rights_reviewer"]),
  ]);
  const { data: opportunity } = await adminClient
    .from("opportunities")
    .insert({ topic: `Vídeo e2e ${run}`, status: "accepted", decision_reason: "e2e" })
    .select("id")
    .single();
  const { data: script } = await adminClient
    .from("scripts")
    .insert({
      opportunity_id: String(opportunity?.id),
      version: 1,
      status: "approved",
      lines_json: [
        {
          kind: "hook",
          voice: "Hola a todos",
          on_screen: "Noticias",
          claim_refs: [],
          pause_ms: 0,
          visual_note: "",
        },
        {
          kind: "body",
          voice: "Esto es un rumor sin confirmar",
          on_screen: "",
          claim_refs: [],
          pause_ms: 0,
          visual_note: "",
        },
      ],
    })
    .select("id")
    .single();
  scriptId = String(script?.id);

  usableAssetId = await insertAsset(`Fondo propio ${run.slice(0, 8)}`, "1");
  blockedAssetId = await insertAsset(`Fondo sin revisar ${run.slice(0, 8)}`, "2");
  await adminClient
    .from("assets")
    .update({ rights_status: "original", reviewed_by: reviewer.id })
    .eq("id", usableAssetId);

  const { data: voice } = await adminClient
    .from("voices")
    .insert({
      provider: "fake",
      provider_voice_id: `e2e-${run}`,
      display_name: `Voz e2e ${run.slice(0, 8)}`,
      approved_at: new Date().toISOString(),
      approved_by: reviewer.id,
    })
    .select("id")
    .single();
  voiceId = String(voice?.id);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  // Projects, assets and voices are kept for the audit trail; only the editor is removed.
  await deleteTestUser(editor);
});

describe("video projects", () => {
  it("an editor turns an approved script into a video and queues it, with authorised media only", async () => {
    const page = await browser.newPage();
    await signIn(page, editor);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/scripts/${scriptId}`);
    await page.getByRole("button", { name: "Crear vídeo" }).click();
    await page.waitForURL(/\/admin\/media\/[0-9a-f-]{36}$/);
    await page
      .getByTestId("media-status")
      .getByText(/Borrador/)
      .waitFor();

    const form = page.getByTestId("media-form");
    const background = form.locator("select[name=background_0]");
    const offered = await background.locator("option").allTextContents();
    expect(offered).toContain(`Fondo propio ${run.slice(0, 8)}`);
    expect(offered).not.toContain(`Fondo sin revisar ${run.slice(0, 8)}`);

    await background.selectOption(usableAssetId);
    await form.locator("select[name=voiceId]").selectOption(voiceId);
    await form.getByLabel("Marca propia en el vídeo").fill("Mi canal");
    await form.getByRole("button", { name: "Guardar proyecto" }).click();
    await form.getByText(/Proyecto guardado/).waitFor();

    await page
      .getByTestId("queue-render")
      .getByRole("button", { name: "Renderizar vídeo" })
      .click();
    await page
      .getByTestId("media-status")
      .getByText(/En cola/)
      .waitFor();

    const projectId = page.url().split("/").at(-1) ?? "";
    const { data: project } = await adminClient
      .from("media_projects")
      .select("status, voice_id, brand, created_by, media_project_scenes(scene_index, asset_id)")
      .eq("id", projectId)
      .single();
    expect(project).toMatchObject({
      status: "queued",
      voice_id: voiceId,
      brand: "Mi canal",
      created_by: editor.id,
      media_project_scenes: [{ scene_index: 0, asset_id: usableAssetId }],
    });
    expect(blockedAssetId).not.toBe(usableAssetId);
    await page.close();
  });
});
