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
const run = randomUUID();
const officialTitle = `Comunicado oficial ${run}`;
const pressTitle = `Nota de prensa ${run}`;
const sourceUrls = [
  `https://example.test/e2e/${run}/official`,
  `https://example.test/e2e/${run}/press`,
];

beforeAll(async () => {
  await ensureSentinelAdmin();
  [author, checker] = await Promise.all([createTestUser(["editor"]), createTestUser(["editor"])]);
  const { data: opportunity } = await adminClient
    .from("opportunities")
    .insert({ topic: `Afirmaciones e2e ${run}` })
    .select("id")
    .single();
  opportunityId = String(opportunity?.id);
  const { data: sources } = await adminClient
    .from("sources")
    .insert([
      {
        url: sourceUrls[0],
        canonical_url: sourceUrls[0],
        publisher: "Estudio",
        title: officialTitle,
        source_type: "official",
        trust_level: 3,
        published_at: "2026-11-10T10:00:00Z",
      },
      {
        url: sourceUrls[1],
        canonical_url: sourceUrls[1],
        publisher: "Un medio",
        title: pressTitle,
        source_type: "press",
        trust_level: 2,
        published_at: "2026-11-11T10:00:00Z",
      },
    ])
    .select("id");
  await adminClient.from("opportunity_sources").insert(
    (sources ?? []).map((source) => ({
      opportunity_id: opportunityId,
      source_id: String(source.id),
    })),
  );
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await adminClient.from("opportunities").delete().eq("id", opportunityId);
  await adminClient.from("sources").delete().in("canonical_url", sourceUrls);
  await Promise.all([author, checker].filter(Boolean).map(deleteTestUser));
});

describe("claims", () => {
  it("refuses a sensitive claim backed by a single non-official source", async () => {
    const page = await browser.newPage();
    await signIn(page, author);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/opportunities/${opportunityId}`);
    const form = page.getByTestId("new-claim");
    await form.getByLabel("Texto").fill("El precio será de 80 euros");
    await form.getByLabel("Certeza").selectOption("reported");
    await form.getByLabel(/^Sensible/).check();
    await form.getByLabel(new RegExp(pressTitle)).check();
    await form.getByRole("button", { name: "Guardar afirmación" }).click();
    await form.getByText(/una sola fuente no oficial/).waitFor();

    const { count } = await adminClient
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("opportunity_id", opportunityId);
    expect(count).toBe(0);
    await page.close();
  });

  it("an editor records a confirmed claim and another editor verifies it", async () => {
    const page = await browser.newPage();
    await signIn(page, author);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/opportunities/${opportunityId}`);
    const form = page.getByTestId("new-claim");
    await form.getByLabel("Texto").fill("El estudio ha anunciado la fecha");
    await form.getByLabel("Certeza").selectOption("confirmed");
    await form.getByLabel(new RegExp(officialTitle)).check();
    await form.getByRole("button", { name: "Guardar afirmación" }).click();
    await form.getByText(/Afirmación guardada/).waitFor();

    const { data: claim } = await adminClient
      .from("claims")
      .select("id, created_by, verified_by")
      .eq("opportunity_id", opportunityId)
      .single();
    expect(claim).toMatchObject({ created_by: author.id, verified_by: null });
    // The author is never offered the verify button.
    const card = page.getByTestId(`claim-${String(claim?.id)}`);
    await card.waitFor();
    expect(await card.getByRole("button", { name: "Verificar" }).count()).toBe(0);
    await page.close();

    const second = await browser.newPage();
    await signIn(second, checker);
    await second.waitForURL(`${baseUrl}/admin`);
    await second.goto(`${baseUrl}/admin/opportunities/${opportunityId}`);
    const checkerCard = second.getByTestId(`claim-${String(claim?.id)}`);
    await checkerCard.getByRole("button", { name: "Verificar" }).click();
    await checkerCard.getByText(/^.*Verificada/).waitFor();

    const { data: verified } = await adminClient
      .from("claims")
      .select("verified_by")
      .eq("id", String(claim?.id))
      .single();
    expect(verified?.verified_by).toBe(checker.id);
    await second.close();
  });
});
