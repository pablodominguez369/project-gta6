import type { TypedSupabaseClient } from "@gta6/db";

/** Private `media` bucket access for the worker. Swappable so renders can be tested offline. */
export interface MediaStore {
  download(path: string): Promise<Uint8Array | null>;
  /** Never overwrites: a render version is written once. */
  upload(path: string, body: Uint8Array, contentType: string): Promise<boolean>;
}

export const MEDIA_BUCKET = "media";

/** Supabase Storage with the secret key (worker only; bypasses RLS). */
export class SupabaseMediaStore implements MediaStore {
  constructor(private readonly client: TypedSupabaseClient) {}

  async download(path: string): Promise<Uint8Array | null> {
    const { data, error } = await this.client.storage.from(MEDIA_BUCKET).download(path);
    if (error) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async upload(path: string, body: Uint8Array, contentType: string): Promise<boolean> {
    const { error } = await this.client.storage
      .from(MEDIA_BUCKET)
      .upload(path, body, { contentType, upsert: false });
    return error === null;
  }
}

export class MemoryMediaStore implements MediaStore {
  readonly files = new Map<string, { body: Uint8Array; contentType: string }>();

  download(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.files.get(path)?.body ?? null);
  }

  upload(path: string, body: Uint8Array, contentType: string): Promise<boolean> {
    if (this.files.has(path)) return Promise.resolve(false);
    this.files.set(path, { body, contentType });
    return Promise.resolve(true);
  }
}
