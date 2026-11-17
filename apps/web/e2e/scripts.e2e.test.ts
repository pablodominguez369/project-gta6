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
let author: TestUser;
let checker: TestUser;
let opportunityId = "";
let claimText = "";
const run = randomUUID();
const sourceUrl = `https://example.test/e2e/${run}/script-source`;

beforeAll(async () => {
  await ensureSentinelAdmin();
  [author, checker] = await Promise.all([createTestUser(["editor"]), createTestUser(["editor"])]);
  const { data: opportunity } = await adminClient
    .from("opportunities")
    .insert({ topic: `Guion e2e ${run}`, status: "accepted", decision_reason: "e2e" })
    .select("id")
    .single();
  opportunityId = String(opportunity?.id);
  const { data: source } = await adminClient
    .from("sources")
    .insert({
      url: sourceUrl,
      canonical_url: sourceUrl,
      publisher: "Estudio",
      title: "Comunicado",
      source_type: "official",
      trust_level: 3,
      published_at: "2026-11-10T10:00:00Z",
    })
    .select("id")
    .single();
  // A confirmed claim from the official source, written by one editor and verified by another.
  claimText = `El estudio anuncia la fecha ${run.slice(0, 8)}`;
  const { data: claim } = await adminClient
    .from("claims")
    .insert({
      opportunity_id: opportunityId,
      text: claimText,
      certainty: "rumor",
      created_by: author.id,
    })
    .select("id")
    .single();
  await adminClient
    .from("claim_sources")
    .insert({ claim_id: String(claim?.id), source_id: String(source?.id) });
  await adminClient.from("claims").update({ certainty: "confirmed" }).eq("id", String(claim?.id));
  await adminClient
    .from("claims")
    .update({ verified_at: new Date().toISOString(), verified_by: checker.id })
    .eq("id", String(claim?.id));
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await adminClient.from("scripts").delete().eq("opportunity_id", opportunityId);
  await adminClient.from("opportunities").delete().eq("id", opportunityId);
  await adminClient.from("sources").delete().eq("canonical_url", sourceUrl);
  await Promise.all([author, checker].filter(Boolean).map(deleteTestUser));
});

describe("scripts", () => {
  it("an editor writes a script, fixes QA errors and sends it to review", async () => {
    const page = await browser.newPage();
    await signIn(page, author);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/opportunities/${opportunityId}`);
    await page.getByRole("button", { name: "Nuevo guion" }).click();
    await page.waitForURL(/\/admin\/scripts\/[0-9a-f-]{36}$/);

    const editor = page.getByTestId("script-editor");
    await editor.getByLabel("Texto de la línea 1").fill("Por fin hay noticias del juego");
    await editor.getByLabel("Tipo de la línea 2").selectOption("body");
    await editor.getByLabel("Texto de la línea 2").fill("El estudio ya ha anunciado la fecha");
    await editor.getByRole("button", { name: "Guardar guion" }).click();
    await page
      .getByTestId("qa-report")
      .getByText(/no cita ninguna afirmación/)
      .waitFor();
    expect(await page.getByRole("button", { name: "Enviar a revisión" }).count()).toBe(0);

    await editor.getByLabel(`Línea 2: ${claimText}`).check();
    await editor.getByRole("button", { name: "Guardar guion" }).click();
    await page.getByTestId("qa-report").getByText("Sin errores.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Enviar a revisión" }).click();
    await page.getByText(/Guion v1 · En revisión/).waitFor();

    const { data: script } = await adminClient
      .from("scripts")
      .select("status, lines_json, created_by")
      .eq("opportunity_id", opportunityId)
      .single();
    expect(script?.status).toBe("in_review");
    expect(script?.created_by).toBe(author.id);
    expect(script?.lines_json).toHaveLength(2);
    await page.close();
  });

  it("an editor asks for an AI draft; only a queued request is written", async () => {
    const page = await browser.newPage();
    await signIn(page, author);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/opportunities/${opportunityId}`);
    await page.getByTestId("ai-draft").getByRole("button", { name: "Redactar con IA" }).click();
    await page
      .getByTestId("ai-requests")
      .getByText(/En cola/)
      .waitFor();

    const { data: requests } = await adminClient
      .from("script_requests")
      .select("status, requested_by")
      .eq("opportunity_id", opportunityId);
    expect(requests).toEqual([{ status: "queued", requested_by: author.id }]);
    await page.close();
  });
});
