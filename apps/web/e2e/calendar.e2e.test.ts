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
let admin: TestUser;
let editor: TestUser;
let channelId = "";

beforeAll(async () => {
  await ensureSentinelAdmin();
  [admin, editor] = await Promise.all([createTestUser(["admin"]), createTestUser(["editor"])]);
  const { data } = await adminClient
    .from("channels")
    .insert({
      platform: "simulated",
      display_name: `Calendario e2e ${randomUUID().slice(0, 8)}`,
      max_posts_per_day: 2,
      min_minutes_between_posts: 60,
    })
    .select("id")
    .single();
  channelId = String(data?.id);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await adminClient.from("channels").delete().eq("id", channelId);
  await Promise.all([admin, editor].filter(Boolean).map(deleteTestUser));
});

describe("calendar", () => {
  it("an admin sets weekly windows and sees proposed slots within the frequency limits", async () => {
    const page = await browser.newPage();
    await signIn(page, admin);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/calendar`);
    const card = page.getByTestId(`calendar-${channelId}`);
    const everyDay = [1, 2, 3, 4, 5, 6, 7].map((day) => `${String(day)} 10:00-14:00`).join("\n");
    await card.getByLabel(/Ventanas/).fill(everyDay);
    await card.getByLabel("Activado").check();
    await card.getByRole("button", { name: "Guardar calendario" }).click();
    await card.getByText("Calendario guardado.").waitFor();

    await page.reload();
    const slots = page.getByTestId(`calendar-${channelId}`).getByTestId("slots").locator("li");
    await slots.first().waitFor();
    // 7 days ahead (today may already be past the window), never more than 2 per day.
    const count = await slots.count();
    expect(count).toBeGreaterThanOrEqual(12);
    expect(count).toBeLessThanOrEqual(14);

    const { data: rule } = await adminClient
      .from("schedule_rules")
      .select("enabled, timezone, windows_json")
      .eq("channel_id", channelId)
      .single();
    expect(rule?.enabled).toBe(true);
    expect(rule?.windows_json).toHaveLength(7);
    await page.close();
  });

  it("rejects an invalid window line", async () => {
    const page = await browser.newPage();
    await signIn(page, admin);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/calendar`);
    const card = page.getByTestId(`calendar-${channelId}`);
    await card.getByLabel(/Ventanas/).fill("lun 09:00-11:00\nvie 12:00-11:00");
    await card.getByRole("button", { name: "Guardar calendario" }).click();
    await card.getByText(/La línea 2 no es válida/).waitFor();
    await page.close();
  });

  it("editors see the calendar but cannot change it", async () => {
    const page = await browser.newPage();
    await signIn(page, editor);
    await page.waitForURL(`${baseUrl}/admin`);
    await page.goto(`${baseUrl}/admin/calendar`);
    await page.getByRole("heading", { name: "Calendario editorial" }).waitFor();
    expect(await page.getByRole("button", { name: "Guardar calendario" }).count()).toBe(0);
    await page.close();
  });
});
