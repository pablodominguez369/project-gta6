import type { ExternalPublication, PlatformCheckpoint } from "@gta6/connectors";
import type { PublicationStatus } from "@gta6/domain";

import type {
  LockResult,
  PublicationContext,
  PublicationStore,
  PublicationUpdate,
  WorkerAuditEvent,
} from "../publication-store";

export interface MemoryPublication {
  status: PublicationStatus;
  errorCode: string | null;
  reconcileRequired: boolean;
  nextAttemptAt: Date | null;
  externalId: string | null;
  publishedAt: Date | null;
}

/** In-memory PublicationStore for fast unit tests of the orchestrator. */
export class MemoryPublicationStore implements PublicationStore {
  readonly audit: WorkerAuditEvent[] = [];
  readonly row: MemoryPublication = {
    status: "queued",
    errorCode: null,
    reconcileRequired: false,
    nextAttemptAt: null,
    externalId: null,
    publishedAt: null,
  };
  systemPaused = false;
  channelPaused = false;
  platform: PublicationContext["channel"]["platform"] = "simulated";
  mode: PublicationContext["channel"]["mode"] = "draft";
  liveUploadsEnabled = false;
  publicUploadsEnabled = false;
  credentialActive = false;
  checkpoint: PlatformCheckpoint | null = null;
  payload: unknown = { title: "Título", description: "", mediaRef: "simulated://media/1" };
  recentPublishedAt: Date[] = [];
  media: PublicationContext["media"] = null;
  locked = false;

  constructor(
    readonly id = "11111111-1111-4111-8111-111111111111",
    readonly channelId = "22222222-2222-4222-8222-222222222222",
  ) {}

  findChannelId(publicationId: string): Promise<string | null> {
    return Promise.resolve(publicationId === this.id ? this.channelId : null);
  }

  async withChannelLock<T>(_channelId: string, fn: () => Promise<T>): Promise<LockResult<T>> {
    if (this.locked) return { acquired: false };
    this.locked = true;
    try {
      return { acquired: true, value: await fn() };
    } finally {
      this.locked = false;
    }
  }

  loadContext(publicationId: string): Promise<PublicationContext | null> {
    if (publicationId !== this.id) return Promise.resolve(null);
    return Promise.resolve({
      publication: {
        id: this.id,
        channelId: this.channelId,
        status: this.row.status,
        idempotencyKey: `key-${this.id}`,
        payload: this.payload,
        reconcileRequired: this.row.reconcileRequired,
        platformCheckpoint: this.checkpoint,
      },
      channel: {
        platform: this.platform,
        mode: this.mode,
        paused: this.channelPaused,
        liveUploadsEnabled: this.liveUploadsEnabled,
        publicUploadsEnabled: this.publicUploadsEnabled,
        credentialActive: this.credentialActive,
        timezone: "Europe/Madrid",
        maxPostsPerDay: 5,
        minMinutesBetweenPosts: 0,
      },
      systemPaused: this.systemPaused,
      recentPublishedAt: this.recentPublishedAt,
      media: this.media,
    });
  }

  update(_publicationId: string, update: PublicationUpdate): Promise<void> {
    if (["succeeded", "failed", "awaiting_manual"].includes(this.row.status)) {
      return Promise.resolve();
    }
    this.row.status = update.status;
    this.row.errorCode = "errorCode" in update ? (update.errorCode ?? null) : null;
    this.row.nextAttemptAt = "nextAttemptAt" in update ? update.nextAttemptAt : null;
    if ("reconcileRequired" in update) {
      this.row.reconcileRequired = true;
    }
    return Promise.resolve();
  }

  markSucceeded(_id: string, external: ExternalPublication, publishedAt: Date): Promise<void> {
    this.row.status = "succeeded";
    this.row.externalId = external.externalId;
    this.row.publishedAt = publishedAt;
    this.row.errorCode = null;
    return Promise.resolve();
  }

  recordAudit(event: WorkerAuditEvent): Promise<void> {
    this.audit.push(event);
    return Promise.resolve();
  }

  saveCheckpoint(_publicationId: string, checkpoint: PlatformCheckpoint): Promise<void> {
    this.checkpoint = checkpoint;
    return Promise.resolve();
  }
}
