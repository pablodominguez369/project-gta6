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
  // Assets and licenses are never deleted by design (audit); their creators are set to null.
  await Promise.all([editor, reviewer].map(deleteTestUser));
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
});
