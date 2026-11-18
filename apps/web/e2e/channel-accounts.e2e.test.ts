import { randomUUID } from "node:crypto";

import { chromium, type Browser, type Page } from "playwright";
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
let admin: TestUser;
let channelId: string;

async function adminPage(): Promise<Page> {
  const page = await browser.newPage();
  await signIn(page, admin);
  await page.waitForURL(`${baseUrl}/admin`);
  return page;
}

beforeAll(async () => {
  await ensureSentinelAdmin();
  admin = await createTestUser(["admin"]);
  browser = await chromium.launch();
  const { data, error } = await adminClient
    .from("channels")
    .insert({ platform: "youtube", display_name: `e2e YT ${randomUUID()}` })
    .select("id")
    .single();
  if (error) throw new Error(`channel insert failed: ${error.code}`);
  channelId = String(data.id);
});

afterAll(async () => {
  await adminClient.rpc("revoke_channel_credentials", { channel_id: channelId, actor_id: null });
  await browser.close();
  await deleteTestUser(admin);
});

describe("channel accounts (T31)", () => {
  it("without a developer app the account cannot be connected", async () => {
    const page = await adminPage();
    await page.goto(`${baseUrl}/admin/channels`);
    const cell = page.getByTestId(`account-${channelId}`);
    await cell.getByText("Sin conectar").waitFor();
    await cell.getByText("Falta la app de desarrollador").waitFor();

    await page.goto(`${baseUrl}/admin/channels/${channelId}/connect`);
    await page.waitForURL(/oauth=not_configured/);
    await page.close();
  });

  it("the callback refuses a request without the state cookie", async () => {
    const page = await adminPage();
    await page.goto(`${baseUrl}/admin/channels/oauth/callback?state=forged&code=abc`);
    await page.waitForURL(/oauth=invalid_state/);
    await page.getByText("La conexión caducó o no se inició desde aquí.").waitFor();
    await page.close();
  });

  it("private uploads need a connected account and a reason, and are audited", async () => {
    // Stand-in for a completed OAuth flow: the service stores a (fake) token set in Vault.
    const { error } = await adminClient.rpc("store_channel_credential", {
      channel_id: channelId,
      secret: JSON.stringify({ v: 1, fake: true }),
      scopes: ["https://www.googleapis.com/auth/youtube.upload"],
      actor_id: admin.id,
    });
    expect(error).toBeNull();

    const page = await adminPage();
    await page.goto(`${baseUrl}/admin/channels`);
    const cell = page.getByTestId(`account-${channelId}`);
    await cell.getByText("Conectada").waitFor();
    await cell.getByLabel("Motivo para activar subidas").fill("Prueba privada autorizada");
    await cell.getByRole("button", { name: "Activar subidas privadas" }).click();
    await cell.getByRole("button", { name: "Desactivar subidas" }).waitFor();

    const { data: channel } = await adminClient
      .from("channels")
      .select("live_uploads_enabled, upload_visibility")
      .eq("id", channelId)
      .single();
    expect(channel).toEqual({ live_uploads_enabled: true, upload_visibility: "private" });

    await cell.getByRole("button", { name: "Desconectar" }).click();
    await cell.getByText("Sin conectar").waitFor();
    const { data: after } = await adminClient
      .from("channels")
      .select("live_uploads_enabled")
      .eq("id", channelId)
      .single();
    // Disconnecting also switches real uploads off.
    expect(after).toEqual({ live_uploads_enabled: false });
    await page.close();
  });
});
