import { DomainError, err, ok, type Result } from "@gta6/domain";
import type { z } from "zod";

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvIssue {
  /** Variable name, e.g. "DATABASE_URL". */
  readonly variable: string;
  /** Zod issue code, e.g. "invalid_type". Never contains the value. */
  readonly reason: string;
}

/**
 * Validates environment variables against a Zod schema.
 *
 * The returned error names the failing variables and the reason, but never includes their
 * values: Zod messages are discarded because some of them can echo the received input.
 */
export function loadEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: EnvSource,
): Result<z.infer<TSchema>, DomainError> {
  // Empty strings are treated as missing so `FOO=` in an env file does not pass validation.
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );

  const parsed = schema.safeParse(normalized);
  if (parsed.success) {
    return ok(parsed.data);
  }

  const issues: EnvIssue[] = parsed.error.issues.map((issue) => ({
    variable: issue.path.map(String).join(".") || "(root)",
    reason: issue.code,
  }));
  const variables = [...new Set(issues.map((issue) => issue.variable))].sort();

  return err(
    new DomainError(
      "VALIDATION_FAILED",
      `Invalid environment configuration: ${issues
        .map((issue) => `${issue.variable} (${issue.reason})`)
        .join(", ")}`,
      { details: { variables: variables.join(",") } },
    ),
  );
}

/**
 * Same as loadEnv but throws. Use only at process start-up, where invalid configuration must
 * stop the process immediately.
 */
export function loadEnvOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  source: EnvSource,
): z.infer<TSchema> {
  const result = loadEnv(schema, source);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
