"use client";

import { startTransition, useActionState, useState, type SubmitEvent } from "react";

import { Field, Select, TextInput } from "@/components/field";
import { IDLE } from "@/lib/action-state";
import { ASSET_KIND_OPTIONS, ASSET_ORIGIN_OPTIONS } from "@/lib/rights";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { prepareAssetUpload, registerAsset } from "./actions";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Uploads the file straight to Storage with a one-time signed URL, then registers it. Large
 * files never go through a server function.
 */
export function AssetUploadForm() {
  const [state, formAction, pending] = useActionState(registerAsset, IDLE);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setUploadError("Elige un archivo.");
      return;
    }
    setUploading(true);
    try {
      const prepared = await prepareAssetUpload({ mimeType: file.type, size: file.size });
      if (!prepared.ok) {
        setUploadError(prepared.message);
        return;
      }
      const { error } = await createSupabaseBrowserClient()
        .storage.from("media")
        .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (error) {
        setUploadError("La subida ha fallado. Vuelve a intentarlo.");
        return;
      }
      formData.delete("file");
      formData.set("storagePath", prepared.path);
      formData.set("contentHash", await sha256Hex(file));
      startTransition(() => {
        formAction(formData);
      });
      form.reset();
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || pending;
  const message = uploadError ?? state.message;
  const isError = uploadError !== null || state.status === "error";

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
      data-testid="asset-upload"
    >
      <Field label="Archivo">
        <input
          type="file"
          name="file"
          required
          accept="image/png,image/jpeg,image/webp,video/mp4,audio/mpeg,audio/wav,font/ttf,font/otf"
          className="text-sm"
        />
      </Field>
      <Field label="Título">
        <TextInput name="title" required maxLength={200} />
      </Field>
      <Field label="Tipo">
        <Select name="kind" options={ASSET_KIND_OPTIONS} />
      </Field>
      <Field label="Origen">
        <Select name="origin" options={ASSET_ORIGIN_OPTIONS} />
      </Field>
      <Field label="Titular de los derechos">
        <TextInput
          name="owner"
          required
          maxLength={200}
          placeholder="Nosotros, el estudio, el banco…"
        />
      </Field>
      <Field label="URL de origen (opcional, https)">
        <TextInput name="sourceUrl" type="url" maxLength={2000} />
      </Field>
      <Field label="Atribución (opcional)">
        <TextInput name="attribution" maxLength={500} />
      </Field>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? "Subiendo…" : "Subir activo"}
        </button>
        {message ? (
          <p
            role="status"
            className={`text-sm ${isError ? "text-red-600" : "text-green-700 dark:text-green-400"}`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
