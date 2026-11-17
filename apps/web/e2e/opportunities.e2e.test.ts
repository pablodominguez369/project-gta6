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
let reader: TestUser;
let opportunityId = "";

beforeAll(async () => {
  await ensureSentinelAdmin();
  [editor, reader] = await Promise.all([createTestUser(["editor"]), createTestUser(["read_only"])]);
  const { data } = await adminClient
    .from("opportunities")
    .insert({ topic: `Oportunidad e2e ${randomUUID()}`, score: 99.99 })
    .select("id")
    .single();
  opportunityId = String(data?.id);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await adminClient.from("opportunities").delete().eq("id", opportunityId);
  await Promise.all([editor, reader].filter(Boolean).map(deleteTestUser));
});

describe("opportunities", () => {
  it("an editor discards an opportunity with a reason", async () => {
    const page = await browser.newPage();
    await signIn(page, editor);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/opportunities`);
    const card = page.getByTestId(`opportunity-${opportunityId}`);
    await card.getByLabel("Motivo para descartar").fill("No es relevante");
    await card.getByRole("button", { name: "Descartar" }).click();
    // The decided card no longer offers actions; it shows its new status and reason.
    await card.getByText("Motivo: No es relevante").waitFor();

    const { data } = await adminClient
      .from("opportunities")
      .select("status, decision_reason, decided_by")
      .eq("id", opportunityId)
      .single();
    expect(data).toEqual({
      status: "discarded",
      decision_reason: "No es relevante",
      decided_by: editor.id,
    });
    await page.close();
  });

  it("read_only sees opportunities without decision buttons", async () => {
    const page = await browser.newPage();
    await signIn(page, reader);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/opportunities`);
    await page.getByRole("heading", { name: "Oportunidades" }).waitFor();
    expect(await page.getByRole("button", { name: "Aceptar" }).count()).toBe(0);
    await page.close();
  });
});
