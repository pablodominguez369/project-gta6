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
let editor: TestUser;
let reader: TestUser;
const createdUrls: string[] = [];

async function pageFor(user: TestUser): Promise<Page> {
  const page = await browser.newPage();
  await signIn(page, user);
  await page.waitForURL(`${baseUrl}/admin`);
  await page.goto(`${baseUrl}/admin/sources`);
  return page;
}

beforeAll(async () => {
  await ensureSentinelAdmin();
  [admin, editor, reader] = await Promise.all([
    createTestUser(["admin"]),
    createTestUser(["editor"]),
    createTestUser(["read_only"]),
  ]);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  for (const url of createdUrls) {
    await adminClient.from("sources").delete().eq("canonical_url", url);
    await adminClient.from("feed_sources").delete().eq("url", url);
  }
  await Promise.all([admin, editor, reader].filter(Boolean).map(deleteTestUser));
});

describe("sources", () => {
  it("an editor adds a manual source; tracking parameters are removed", async () => {
    const slug = randomUUID();
    const canonical = `https://news.example.test/${slug}`;
    createdUrls.push(canonical);
    const page = await pageFor(editor);
    const form = page.getByTestId("add-source");
    await form.getByLabel("URL").fill(`https://www.news.example.test/${slug}/?utm_source=e2e`);
    await form.getByLabel("Título").fill(`Fuente e2e ${slug}`);
    await form.getByLabel("Medio").fill("Medio e2e");
    await form.getByRole("button", { name: "Añadir fuente" }).click();
    await page.getByText("Fuente añadida.").waitFor();

    const { data } = await adminClient
      .from("sources")
      .select("canonical_url, added_by")
      .eq("canonical_url", canonical);
    expect(data).toEqual([{ canonical_url: canonical, added_by: editor.id }]);
    await page.close();
  });

  it("read_only sees sources but cannot add them", async () => {
    const page = await pageFor(reader);
    await page.getByTestId("sources-table").waitFor();
    expect(await page.getByTestId("add-source").count()).toBe(0);
    expect(await page.getByTestId("add-feed").count()).toBe(0);
    await page.close();
  });

  it("an admin adds a feed, which stays disabled until its terms are recorded", async () => {
    const url = `https://feeds.example.test/${randomUUID()}.xml`;
    createdUrls.push(url);
    const page = await pageFor(admin);
    const form = page.getByTestId("add-feed");
    await form.getByLabel("URL del feed (https)").fill(url);
    await form.getByLabel("Medio").fill("Feed e2e");
    await form.getByRole("button", { name: "Añadir feed" }).click();
    await page.getByText("Feed añadido (desactivado hasta revisar sus términos).").waitFor();

    const { data: feed } = await adminClient
      .from("feed_sources")
      .select("id, enabled")
      .eq("url", url)
      .single();
    expect(feed?.enabled).toBe(false);

    await page.reload();
    const row = page.getByTestId(`feed-${String(feed?.id)}`);
    await row.getByLabel("URL de los términos de uso").fill("https://feeds.example.test/terms");
    await row.getByLabel("He revisado que los términos permiten el uso automatizado").check();
    await row.getByRole("button", { name: "Activar" }).click();
    await page.getByText("Feed activado.").waitFor();

    const { data: enabled } = await adminClient
      .from("feed_sources")
      .select("enabled, terms_checked_at")
      .eq("url", url)
      .single();
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.terms_checked_at).not.toBeNull();
    await page.close();
  });
});
