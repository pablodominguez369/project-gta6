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

// A valid 1x1 PNG; the run id is appended after IEND so each run uploads a different file.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let browser: Browser;
let editor: TestUser;
let reviewer: TestUser;
const run = randomUUID();
const title = `Captura oficial ${run.slice(0, 8)}`;
const licensor = `Estudio ${run.slice(0, 8)}`;

beforeAll(async () => {
  await ensureSentinelAdmin();
  [editor, reviewer] = await Promise.all([
    createTestUser(["editor"]),
    createTestUser(["rights_reviewer"]),
  ]);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  // Assets and licenses are never deleted (audit). The reviewer stays: rights decisions keep
  // their reviewer (on delete restrict), like approvals.
  await deleteTestUser(editor);
});

describe("rights registry", () => {
  it("an editor uploads official material; it is blocked until a reviewer clears it", async () => {
    const page = await browser.newPage();
    await signIn(page, editor);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/assets`);
    const upload = page.getByTestId("asset-upload");
    await upload.getByLabel("Archivo").setInputFiles({
      name: "captura.png",
      mimeType: "image/png",
      buffer: Buffer.concat([PNG_1X1, Buffer.from(run)]),
    });
    await upload.getByLabel("Título").fill(title);
    await upload.locator("select[name=origin]").selectOption("official");
    await upload.getByLabel("Titular de los derechos").fill("Estudio");
    await upload.getByRole("button", { name: "Subir activo" }).click();
    await upload.getByText(/Activo registrado/).waitFor();

    const { data: asset } = await adminClient
      .from("assets")
      .select("id, rights_status, mime_type, size_bytes, content_hash, created_by")
      .eq("title", title)
      .single();
    expect(asset).toMatchObject({
      rights_status: "requires_permission",
      mime_type: "image/png",
      size_bytes: PNG_1X1.length + run.length,
      created_by: editor.id,
    });
    expect(asset?.content_hash).toMatch(/^[0-9a-f]{64}$/);

    await page.reload();
    const card = page.getByTestId(`asset-${String(asset?.id)}`);
    await card.getByText(/Bloqueado/).waitFor();
    // Editors never see the rights decision form.
    expect(await card.getByRole("button", { name: "Guardar decisión" }).count()).toBe(0);
    await page.close();

    const second = await browser.newPage();
    await signIn(second, reviewer);
    await second.waitForURL(`${baseUrl}/admin`);
    await second.goto(`${baseUrl}/admin/assets`);
    const reviewCard = second.getByTestId(`asset-${String(asset?.id)}`);

    // Official material can never be marked original.
    await reviewCard.locator("select[name=rightsStatus]").selectOption("original");
    await reviewCard.getByRole("button", { name: "Guardar decisión" }).click();
    await reviewCard.getByText(/necesitan licencia/).waitFor();

    const license = second.getByTestId("new-license");
    await license.getByLabel("Titular que concede").fill(licensor);
    await license.getByLabel("Qué permite").fill("Permiso escrito para usar capturas");
    await license.getByLabel("YouTube").check();
    await license.getByLabel("Permite uso comercial").check();
    await license.getByRole("button", { name: "Guardar licencia" }).click();
    await license.getByText(/Licencia guardada/).waitFor();

    const { data: savedLicense } = await adminClient
      .from("licenses")
      .select("id")
      .eq("licensor", licensor)
      .single();
    await second.reload();
    const fresh = second.getByTestId(`asset-${String(asset?.id)}`);
    await fresh.locator("select[name=rightsStatus]").selectOption("cleared");
    await fresh.locator("select[name=licenseId]").selectOption(String(savedLicense?.id));
    await fresh.getByRole("button", { name: "Guardar decisión" }).click();
    await fresh.getByText(/Decisión guardada/).waitFor();
    await second.reload();
    await second
      .getByTestId(`asset-${String(asset?.id)}`)
      .getByText(/Se puede usar/)
      .waitFor();

    const { data: cleared } = await adminClient
      .from("assets")
      .select("rights_status, reviewed_by")
      .eq("id", String(asset?.id))
      .single();
    expect(cleared).toEqual({ rights_status: "cleared", reviewed_by: reviewer.id });
    await second.close();
  });
  it("a reviewer approves a licensed or fake voice but not an unlicensed one", async () => {
    const page = await browser.newPage();
    await signIn(page, reviewer);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/assets`);

    for (const [provider, name] of [
      ["fake", `Voz de prueba ${run.slice(0, 8)}`],
      ["acme", `Voz sin licencia ${run.slice(0, 8)}`],
    ] as const) {
      const form = page.getByTestId("new-voice");
      await form.getByLabel(/^Proveedor/).fill(provider);
      await form.getByLabel("Identificador de la voz en el proveedor").fill(`v-${run}`);
      await form.getByLabel("Nombre", { exact: true }).fill(name);
      await form.getByRole("button", { name: "Guardar voz" }).click();
      await form.getByText(/Voz registrada/).waitFor();
      await page.reload();
    }

    const { data: voices } = await adminClient
      .from("voices")
      .select("id, provider")
      .eq("provider_voice_id", `v-${run}`);
    const fakeId = String(voices?.find((v) => v.provider === "fake")?.id);
    const acmeId = String(voices?.find((v) => v.provider === "acme")?.id);

    await page.getByTestId(`voice-${acmeId}`).getByRole("button", { name: "Aprobar" }).click();
    await page
      .getByTestId(`voice-${acmeId}`)
      .getByText(/falta la licencia/)
      .waitFor();

    await page.getByTestId(`voice-${fakeId}`).getByRole("button", { name: "Aprobar" }).click();
    await page
      .getByTestId(`voice-${fakeId}`)
      .getByText(/Voz aprobada/)
      .waitFor();
    await page.reload();
    await page
      .getByTestId(`voice-${fakeId}`)
      .getByText(/Se puede usar/)
      .waitFor();

    const { data: approved } = await adminClient
      .from("voices")
      .select("approved_by")
      .eq("id", fakeId)
      .single();
    expect(approved?.approved_by).toBe(reviewer.id);
    await page.close();
  });
});
