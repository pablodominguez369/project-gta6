import { DomainError, err, ok, type Result } from "@gta6/domain";

import { parseSecretRef, type SecretStore } from "./secret-store";

/**
 * Reads one secret through `public.read_vault_secret` (service role only). The caller provides
 * the call: the web app through the Supabase admin client, the worker through its direct
 * Postgres connection. Returns null when the secret does not exist.
 */
export type VaultReader = (secretRef: string) => Promise<string | null>;

const VAULT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `vault://<uuid>` references in Supabase Vault (ADR 0005). Allowed in every environment. */
export class VaultSecretStore implements SecretStore {
  readonly schemes = ["vault"] as const;

  constructor(private readonly read: VaultReader) {}

  async resolve(secretRef: string): Promise<Result<string, DomainError>> {
    const parsed = parseSecretRef(secretRef);
    if (parsed?.scheme !== "vault" || !VAULT_ID.test(parsed.path)) {
      return err(new DomainError("VALIDATION_FAILED", "Unsupported secret ref"));
    }
    let value: string | null;
    try {
      value = await this.read(secretRef);
    } catch {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Vault unreachable"));
    }
    return value ? ok(value) : err(new DomainError("NOT_FOUND", "Secret not found"));
  }
}

/** Dispatches each reference to the store that handles its scheme. */
export class CompositeSecretStore implements SecretStore {
  readonly schemes: readonly string[];

  constructor(private readonly stores: readonly SecretStore[]) {
    this.schemes = stores.flatMap((store) => store.schemes);
  }

  resolve(secretRef: string): Promise<Result<string, DomainError>> {
    const scheme = parseSecretRef(secretRef)?.scheme;
    const store = this.stores.find((candidate) => scheme && candidate.schemes.includes(scheme));
    return store
      ? store.resolve(secretRef)
      : Promise.resolve(err(new DomainError("VALIDATION_FAILED", "Unsupported secret ref")));
  }
}
