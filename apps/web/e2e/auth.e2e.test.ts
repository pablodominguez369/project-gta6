import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
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
let noRole: TestUser;

beforeAll(async () => {
  await ensureSentinelAdmin();
  [admin, editor, noRole] = await Promise.all([
    createTestUser(["admin"]),
    createTestUser(["editor"]),
    createTestUser([]),
  ]);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await Promise.all([admin, editor, noRole].filter(Boolean).map(deleteTestUser));
});

describe("authentication and role guards", () => {
  it("redirects anonymous visitors to /login", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/admin/controls`);

    expect(new URL(page.url()).pathname).toBe("/login");
    await page.close();
  });

  it("shows a generic error for wrong credentials", async () => {
    const page = await browser.newPage();
    await signIn(page, { email: editor.email, password: "wrong-password-123" });

    await page.getByText("Email o contraseña incorrectos.").waitFor();
    expect(new URL(page.url()).pathname).toBe("/login");
    await page.close();
  });

  it("answers 403 to an editor on /admin/controls", async () => {
    const page = await browser.newPage();
    await signIn(page, editor);
    await page.waitForURL(`${baseUrl}/admin`);

    const response = await page.goto(`${baseUrl}/admin/controls`);
    expect(response?.status()).toBe(403);
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toContain(
      "No tienes permiso",
    );
    await page.close();
  });

  it("lets an admin open /admin/controls", async () => {
    const page = await browser.newPage();
    await signIn(page, admin);
    await page.waitForURL(`${baseUrl}/admin`);

    const response = await page.goto(`${baseUrl}/admin/controls`);
    expect(response?.status()).toBe(200);
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Controles");
    await page.close();
  });

  it("answers 403 to a signed-in user without any role", async () => {
    const page = await browser.newPage();
    await signIn(page, noRole);
    await page.waitForLoadState("networkidle");

    const response = await page.goto(`${baseUrl}/admin`);
    expect(response?.status()).toBe(403);
    await page.close();
  });
});
