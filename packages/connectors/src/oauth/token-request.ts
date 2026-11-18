import { DomainError, err, ok, type Result } from "@gta6/domain";
import type { z } from "zod";

import type { OAuthFetch } from "./oauth-provider";

const TIMEOUT_MS = 15_000;

/**
 * POSTs a form to a token endpoint and validates the JSON answer. Error bodies are never copied
 * into the error (they can echo codes or tokens); only the HTTP status and the OAuth error code.
 */
export async function postTokenForm<T>(
  fetchImpl: OAuthFetch,
  url: string,
  form: Readonly<Record<string, string>>,
  schema: z.ZodType<T>,
): Promise<Result<T, DomainError>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    return err(new DomainError("EXTERNAL_UNAVAILABLE", "Token endpoint unreachable"));
  }
  const body: unknown = await response.json().catch(() => null);
  const oauthError =
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : null;
  if (oauthError === "invalid_grant") {
    return err(
      new DomainError("CREDENTIAL_EXPIRED", "Authorization is no longer valid; reconnect", {
        details: { status: response.status, oauthError },
      }),
    );
  }
  if (response.status === 429) return err(new DomainError("RATE_LIMITED", "Token endpoint 429"));
  if (response.status >= 500) {
    return err(new DomainError("EXTERNAL_UNAVAILABLE", "Token endpoint error"));
  }
  if (!response.ok || oauthError) {
    return err(
      new DomainError("FORBIDDEN", "Token request refused", {
        details: { status: response.status, oauthError },
      }),
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return err(new DomainError("EXTERNAL_UNAVAILABLE", "Unexpected token response"));
  }
  return ok(parsed.data);
}
