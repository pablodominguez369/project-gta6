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
let reviewer: TestUser;
let opportunityId = "";
let claimId = "";
const run = randomUUID();
const sourceUrl = `https://example.test/e2e/${run}/approval-source`;

/** A script in review written by `author`, citing the verified claim in its body line. */
async function insertScriptInReview(version: number): Promise<string> {
  const { data, error } = await adminClient
    .from("scripts")
    .insert({
      opportunity_id: opportunityId,
      version,
      status: "in_review",
      created_by: author.id,
      target_duration_s: 30,
      cta: "Síguenos para más noticias",
      lines_json: [
        {
          kind: "hook",
          voice: "Por fin hay noticias del juego",
          on_screen: "",
          claim_refs: [],
          pause_ms: 0,
          visual_note: "",
        },
        {
          kind: "body",
          voice: "El estudio ya ha anunciado la fecha",
          on_screen: "",
          claim_refs: [claimId],
          pause_ms: 0,
          visual_note: "",
        },
      ],
    })
    .select("id")
    .single();
  if (error) throw new Error(`script insert failed: ${error.code}`);
  return String(data.id);
}

beforeAll(async () => {
  await ensureSentinelAdmin();
  [author, reviewer] = await Promise.all([createTestUser(["editor"]), createTestUser(["editor"])]);
  const { data: opportunity } = await adminClient
    .from("opportunities")
    .insert({ topic: `Aprobación e2e ${run}`, status: "accepted", decision_reason: "e2e" })
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
  const { data: claim } = await adminClient
    .from("claims")
    .insert({
      opportunity_id: opportunityId,
      text: `El estudio anuncia la fecha ${run.slice(0, 8)}`,
      certainty: "rumor",
      created_by: author.id,
    })
    .select("id")
    .single();
  claimId = String(claim?.id);
  await adminClient
    .from("claim_sources")
    .insert({ claim_id: claimId, source_id: String(source?.id) });
  await adminClient.from("claims").update({ certainty: "confirmed" }).eq("id", claimId);
  await adminClient
    .from("claims")
    .update({ verified_at: new Date().toISOString(), verified_by: reviewer.id })
    .eq("id", claimId);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  // Approvals are append-only and keep their reviewer (on delete restrict), so the reviewer, the
  // test scripts and their approvals stay in the local database. Only the author is removed.
  await deleteTestUser(author);
});

describe("script approvals", () => {
  it("the author cannot review; another editor approves", async () => {
    const scriptId = await insertScriptInReview(1);

    const own = await browser.newPage();
    await signIn(own, author);
    await own.waitForURL(`${baseUrl}/admin`);
    await own.goto(`${baseUrl}/admin/scripts/${scriptId}`);
    await own.getByText(/En revisión/).waitFor();
    expect(await own.getByTestId("review").count()).toBe(0);
    await own.close();

    const page = await browser.newPage();
    await signIn(page, reviewer);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/scripts/${scriptId}`);
    await page.getByTestId("review").getByRole("button", { name: "Aprobar" }).click();
    await page.getByText(/Guion v1 · Aprobado/).waitFor();
    await page
      .getByTestId("approvals")
      .getByText(/Aprobado/)
      .waitFor();

    const { data: script } = await adminClient
      .from("scripts")
      .select("status")
      .eq("id", scriptId)
      .single();
    expect(script?.status).toBe("approved");
    const { data: approvals } = await adminClient
      .from("approvals")
      .select("decision, reviewer_id")
      .eq("target_id", scriptId);
    expect(approvals).toEqual([{ decision: "approved", reviewer_id: reviewer.id }]);
    await page.close();
  });

  it("refuses approval once a cited claim changed after submission", async () => {
    const scriptId = await insertScriptInReview(2);
    // Editing the claim drops its verification, so the script QA no longer passes.
    await adminClient
      .from("claims")
      .update({ text: `El estudio confirma la fecha ${run.slice(0, 8)}` })
      .eq("id", claimId);

    const page = await browser.newPage();
    await signIn(page, reviewer);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/scripts/${scriptId}`);
    const review = page.getByTestId("review");
    await review.getByRole("button", { name: "Aprobar" }).click();
    await review.getByText(/La revisión automática ya no pasa/).waitFor();

    await review.getByLabel("Motivo de los cambios").fill("La afirmación ha cambiado");
    await review.getByRole("button", { name: "Pedir cambios" }).click();
    await page.getByText(/Guion v2 · Cambios pedidos/).waitFor();

    const { data: script } = await adminClient
      .from("scripts")
      .select("status")
      .eq("id", scriptId)
      .single();
    expect(script?.status).toBe("changes_requested");
    await page.close();
  });
});
