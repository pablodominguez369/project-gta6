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
let publisher: TestUser;
let channelId: string;
let publicationId: string;

beforeAll(async () => {
  await ensureSentinelAdmin();
  publisher = await createTestUser(["publisher"]);
  browser = await chromium.launch();

  const { data: channel, error: channelError } = await adminClient
    .from("channels")
    .insert({
      platform: "instagram",
      display_name: `e2e IG manual ${randomUUID()}`,
      mode: "manual",
    })
    .select("id")
    .single();
  if (channelError) throw new Error(`channel insert failed: ${channelError.code}`);
  channelId = String(channel.id);

  // The worker would set awaiting_manual after its gates; e2e has no worker, so the row starts
  // there (inserted with the secret key, like the worker's direct connection).
  const { data: publication, error } = await adminClient
    .from("publications")
    .insert({
      channel_id: channelId,
      idempotency_key: `pub_${randomUUID()}`,
      status: "awaiting_manual",
      payload_json: {
        title: "Tráiler: lo que sabemos",
        description: "Resumen con fuentes.",
        mediaRef: "renders/e2e/master.mp4",
        syntheticMedia: true,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`publication insert failed: ${error.code}`);
  publicationId = String(publication.id);
});

afterAll(async () => {
  await browser.close();
  await deleteTestUser(publisher);
});

describe("manual publication package", () => {
  it("shows the package and records the permalink, refusing links from other sites", async () => {
    const page = await browser.newPage();
    await signIn(page, publisher);
    await page.waitForURL(`${baseUrl}/admin`);

    await page.goto(`${baseUrl}/admin/publications`);
    await page.getByTestId(`manual-package-${publicationId}`).click();
    await page.waitForURL(`${baseUrl}/admin/publications/${publicationId}`);
    await expect(page.getByTestId("package-title").textContent()).resolves.toBe(
      "Tráiler: lo que sabemos",
    );
    await page.getByTestId("package-disclosure").waitFor();

    const form = page.getByTestId("complete-manual");
    await form.getByLabel("Enlace de la publicación").fill("https://www.youtube.com/shorts/abc");
    await form.getByRole("button", { name: "Marcar como publicada" }).click();
    await page.getByText("El enlace debe ser https y de la propia plataforma.").waitFor();

    const permalink = "https://www.instagram.com/reel/e2e123/";
    await form.getByLabel("Enlace de la publicación").fill(permalink);
    await form.getByRole("button", { name: "Marcar como publicada" }).click();
    // The page re-renders without the form and shows the recorded date.
    await page.getByText("Ya registrada el", { exact: false }).waitFor();

    const { data } = await adminClient
      .from("publications")
      .select("status, permalink")
      .eq("id", publicationId)
      .single();
    expect(data).toEqual({ status: "succeeded", permalink });

    const { data: audit } = await adminClient
      .from("audit_events")
      .select("actor_id")
      .eq("action", "publications.manual_completed")
      .eq("object_id", publicationId);
    expect(audit).toEqual([{ actor_id: publisher.id }]);
    await page.close();
  });
});
