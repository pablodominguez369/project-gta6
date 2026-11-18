import { randomUUID } from "node:crypto";

import { DomainError, err, ok, type Result } from "@gta6/domain";

import {
  publishRequestSchema,
  type ExternalPublication,
  type PublisherAdapter,
  type PublisherCapabilities,
  type PublishRequest,
  type ReconcileResult,
} from "./publisher-adapter";

/** Faults the simulator can inject, to exercise every failure path without a real platform. */
export type SimulatedFault =
  | "none"
  /** The platform accepts and stores the post, but the response is lost (timeout). */
  | "timeout_after_accept"
  /** The request times out before the platform stores anything. */
  | "timeout_before_accept"
  | "rate_limited"
  | "credential_expired"
  | "unavailable"
  /** Reconciliation itself fails (platform unreachable while checking). */
  | "reconcile_unavailable";

/** Remote side of the simulated platform. In-memory by default; T10 adds a persistent store. */
export interface SimulatedRemoteStore {
  findByIdempotencyKey(key: string): Promise<ExternalPublication | null>;
  findByExternalId(externalId: string): Promise<ExternalPublication | null>;
  save(key: string, publication: ExternalPublication): Promise<void>;
  count(): Promise<number>;
}

export class InMemorySimulatedRemoteStore implements SimulatedRemoteStore {
  private readonly byKey = new Map<string, ExternalPublication>();

  findByIdempotencyKey(key: string): Promise<ExternalPublication | null> {
    return Promise.resolve(this.byKey.get(key) ?? null);
  }

  findByExternalId(externalId: string): Promise<ExternalPublication | null> {
    for (const publication of this.byKey.values()) {
      if (publication.externalId === externalId) return Promise.resolve(publication);
    }
    return Promise.resolve(null);
  }

  save(key: string, publication: ExternalPublication): Promise<void> {
    // A real platform would happily store duplicates; the simulator does too, keyed by an
    // internal counter, so tests can detect them. The lookup returns the first one.
    if (this.byKey.has(key)) {
      this.byKey.set(`${key}#dup-${String(this.byKey.size)}`, publication);
    } else {
      this.byKey.set(key, publication);
    }
    return Promise.resolve();
  }

  count(): Promise<number> {
    return Promise.resolve(this.byKey.size);
  }
}

export interface SimulatedPublisherOptions {
  readonly store?: SimulatedRemoteStore;
  /** Fault for each publish call, in order; afterwards "none". */
  readonly publishFaults?: readonly SimulatedFault[];
  /** Fault for each reconcile call, in order; afterwards "none". */
  readonly reconcileFaults?: readonly SimulatedFault[];
  readonly baseUrl?: string;
}

export const SIMULATED_CAPABILITIES: PublisherCapabilities = {
  directPublish: true,
  scheduledPublish: true,
  reconcileByRequest: true,
  privateVisibility: true,
  // The simulator is ours: its behaviour is defined by this file, not by external docs.
  verifiedAgainstDocsAt: null,
  docsUrls: [],
};

/**
 * Fake platform for development and tests. Never contacts any network service.
 * Behaves like a non-idempotent platform: publishing the same request twice creates two posts.
 */
export class SimulatedPublisher implements PublisherAdapter {
  readonly platform = "simulated" as const;
  readonly capabilities = SIMULATED_CAPABILITIES;

  private readonly store: SimulatedRemoteStore;
  private readonly publishFaults: SimulatedFault[];
  private readonly reconcileFaults: SimulatedFault[];
  private readonly baseUrl: string;

  constructor(options: SimulatedPublisherOptions = {}) {
    this.store = options.store ?? new InMemorySimulatedRemoteStore();
    this.publishFaults = [...(options.publishFaults ?? [])];
    this.reconcileFaults = [...(options.reconcileFaults ?? [])];
    this.baseUrl = options.baseUrl ?? "https://simulated.invalid/p";
  }

  validate(request: PublishRequest): Result<PublishRequest, DomainError> {
    const parsed = publishRequestSchema.safeParse(request);
    return parsed.success
      ? ok(parsed.data)
      : err(new DomainError("VALIDATION_FAILED", "Invalid publish request"));
  }

  async publish(request: PublishRequest): Promise<Result<ExternalPublication, DomainError>> {
    const valid = this.validate(request);
    if (!valid.ok) return valid;

    const fault = this.publishFaults.shift() ?? "none";
    switch (fault) {
      case "rate_limited":
        return err(new DomainError("RATE_LIMITED", "Simulated 429"));
      case "credential_expired":
        return err(new DomainError("CREDENTIAL_EXPIRED", "Simulated expired token"));
      case "unavailable":
        return err(new DomainError("EXTERNAL_UNAVAILABLE", "Simulated 503"));
      case "timeout_before_accept":
        return err(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "Simulated timeout"));
      case "timeout_after_accept": {
        await this.store.save(request.idempotencyKey, this.newPublication(request));
        return err(new DomainError("AMBIGUOUS_EXTERNAL_STATE", "Simulated timeout"));
      }
      case "reconcile_unavailable":
      case "none": {
        const publication = this.newPublication(request);
        await this.store.save(request.idempotencyKey, publication);
        return ok(publication);
      }
    }
  }

  async reconcile(request: PublishRequest): Promise<Result<ReconcileResult, DomainError>> {
    const fault = this.reconcileFaults.shift() ?? "none";
    if (fault !== "none") {
      return err(new DomainError("EXTERNAL_UNAVAILABLE", "Simulated reconcile failure"));
    }
    const existing = await this.store.findByIdempotencyKey(request.idempotencyKey);
    return ok(existing ? { found: true, publication: existing } : { found: false });
  }

  async getStatus(externalId: string): Promise<Result<ExternalPublication, DomainError>> {
    const existing = await this.store.findByExternalId(externalId);
    return existing ? ok(existing) : err(new DomainError("NOT_FOUND", "Unknown external id"));
  }

  private newPublication(request: PublishRequest): ExternalPublication {
    const externalId = `sim_${randomUUID()}`;
    return {
      externalId,
      permalink: `${this.baseUrl}/${externalId}`,
      status: request.scheduledAt ? "scheduled" : "published",
    };
  }
}
