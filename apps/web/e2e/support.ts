import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import type { AppRole } from "@gta6/domain";
import { createClient } from "@supabase/supabase-js";

/** Loads apps/web/.env.local without printing anything. Shell variables take precedence. */
function loadLocalEnv(): void {
  const file = resolve(import.meta.dirname, "../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

loadLocalEnv();

export const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for e2e tests`);
  return value;
}

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl)) {
  throw new Error("e2e tests only run against a local Supabase instance");
}

export const adminClient = createClient(supabaseUrl, requireEnv("SUPABASE_SECRET_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

export async function createTestUser(roles: readonly AppRole[]): Promise<TestUser> {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.code ?? "unknown"}`);
  const id = data.user.id;

  if (roles.length > 0) {
    const { error: roleError } = await adminClient
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: id, role })));
    if (roleError) throw new Error(`role insert failed: ${roleError.code}`);
  }
  return { id, email, password };
}

/**
 * The database refuses to remove the last admin, so the suite keeps one permanent local admin
 * that is never deleted. Its password is not stored anywhere.
 */
export async function ensureSentinelAdmin(): Promise<void> {
  const email = "e2e-sentinel-admin@example.test";
  const { data } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  let id = data.users.find((user) => user.email === email)?.id;
  if (!id) {
    const created = await adminClient.auth.admin.createUser({
      email,
      password: randomBytes(24).toString("base64url"),
      email_confirm: true,
    });
    if (created.error)
      throw new Error(`sentinel create failed: ${created.error.code ?? "unknown"}`);
    id = created.data.user.id;
  }
  await adminClient.from("user_roles").upsert({ user_id: id, role: "admin" });
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) throw new Error(`deleteUser failed: ${error.code ?? "unknown"}`);
}

export async function signIn(
  page: import("playwright").Page,
  user: Pick<TestUser, "email" | "password">,
): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Contraseña").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
}
