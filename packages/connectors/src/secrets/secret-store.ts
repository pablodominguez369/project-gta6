import { DomainError, err, ok, type Result } from "@gta6/domain";

/**
 * Resolves `credential_refs.secret_ref` URIs to secret values at the moment of use.
 * Values are never logged, persisted or returned to the browser.
 */
export interface SecretStore {
  /** URI schemes this store handles, e.g. ["env"]. */
  readonly schemes: readonly string[];
  resolve(secretRef: string): Promise<Result<string, DomainError>>;
}

export function parseSecretRef(secretRef: string): { scheme: string; path: string } | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([A-Za-z0-9._/-]+)$/.exec(secretRef);
  return match?.[1] && match[2] ? { scheme: match[1], path: match[2] } : null;
}

/**
 * Local development only: `env://NAME` reads process.env.NAME. Refuses to run in staging or
 * production, where a real secret manager must be used (decided in Phase 0, see ADR 0003).
 */
export class EnvSecretStore implements SecretStore {
  readonly schemes = ["env"] as const;

  constructor(
    private readonly appEnv: "local" | "staging" | "production",
    private readonly source: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  resolve(secretRef: string): Promise<Result<string, DomainError>> {
    if (this.appEnv !== "local") {
      return Promise.resolve(
        err(new DomainError("FORBIDDEN", "EnvSecretStore is only allowed in local development")),
      );
    }
    const parsed = parseSecretRef(secretRef);
    if (parsed?.scheme !== "env" || !/^[A-Z][A-Z0-9_]*$/.test(parsed.path)) {
      return Promise.resolve(err(new DomainError("VALIDATION_FAILED", "Unsupported secret ref")));
    }
    const value = this.source[parsed.path];
    return Promise.resolve(
      value
        ? ok(value)
        : err(
            new DomainError("NOT_FOUND", "Secret not set", { details: { secretRef: parsed.path } }),
          ),
    );
  }
}
