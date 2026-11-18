import {
  evaluateAssetRights,
  hasAnyRole,
  RIGHTS_ISSUE_MESSAGES,
  RIGHTS_STATUS_LABELS,
} from "@gta6/domain";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import {
  ASSET_KIND_LABELS,
  ASSET_ORIGIN_LABELS,
  PLATFORM_OPTIONS,
  RIGHTS_STATUS_OPTIONS,
} from "@/lib/rights";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createLicense, reviewAsset } from "./actions";
import { AssetUploadForm } from "./upload-form";

const toDate = (value: string | null): Date | null => (value ? new Date(value) : null);

export default async function AssetsPage() {
  const user = await requireRole("member");
  const canUpload = hasAnyRole(user.roles, ["admin", "editor", "rights_reviewer"]);
  const canReview = hasAnyRole(user.roles, ["admin", "rights_reviewer"]);
  const supabase = await createSupabaseServerClient();
  const [{ data: assets }, { data: licenses }] = await Promise.all([
    supabase
      .from("assets")
      .select(
        "id, title, kind, origin, owner, source_url, attribution, rights_status, rights_note, license_id, mime_type, size_bytes, created_at, reviewed_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("licenses")
      .select(
        "id, licensor, scope, territory, allowed_platforms, commercial_allowed, valid_from, expires_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const licenseById = new Map((licenses ?? []).map((l) => [l.id, l]));
  const licenseOptions = [
    { value: "", label: "Sin licencia" },
    ...(licenses ?? []).map((l) => ({
      value: l.id,
      label: `${l.licensor}: ${l.scope.slice(0, 60)}`,
    })),
  ];
  const now = new Date();

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Derechos y activos</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Todo lo que aparece en un vídeo (imágenes, clips, música, tipografías, voces) se registra
          aquí. Solo se puede usar lo «Original» (creado por nosotros o con IA con uso comercial) o
          lo «Autorizado» con una licencia en vigor. Un tráiler público no es una licencia.
        </p>
      </div>

      <div>
        <h2 className="font-medium">Activos</h2>
        {(assets ?? []).length === 0 ? <p className="text-sm">Todavía no hay activos.</p> : null}
        <ul className="mt-2 flex flex-col gap-3">
          {(assets ?? []).map((asset) => {
            const license = asset.license_id ? licenseById.get(asset.license_id) : undefined;
            const check = evaluateAssetRights(
              {
                id: asset.id,
                origin: asset.origin,
                rightsStatus: asset.rights_status,
                license: license
                  ? {
                      id: license.id,
                      allowedPlatforms: license.allowed_platforms,
                      commercialAllowed: license.commercial_allowed,
                      validFrom: toDate(license.valid_from),
                      expiresAt: toDate(license.expires_at),
                    }
                  : null,
              },
              { platform: null, commercial: true, at: now },
            );
            return (
              <li
                key={asset.id}
                className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800"
                data-testid={`asset-${asset.id}`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <a href={`/admin/assets/${asset.id}/file`} className="font-medium underline">
                    {asset.title}
                  </a>
                  <span className="text-neutral-500">
                    {ASSET_KIND_LABELS[asset.kind]} · {ASSET_ORIGIN_LABELS[asset.origin]} ·{" "}
                    {asset.owner} · {formatDateTime(asset.created_at)}
                  </span>
                </div>
                <p className="mt-1">
                  Derechos: <strong>{RIGHTS_STATUS_LABELS[asset.rights_status]}</strong>
                  {license ? ` · Licencia: ${license.licensor}` : ""}
                  {check.usable ? (
                    <span className="text-green-700 dark:text-green-400"> · Se puede usar</span>
                  ) : (
                    <span className="text-red-600">
                      {" "}
                      · Bloqueado: {check.issues.map((i) => RIGHTS_ISSUE_MESSAGES[i]).join(" ")}
                    </span>
                  )}
                </p>
                {asset.rights_note ? <p className="text-neutral-500">{asset.rights_note}</p> : null}
                {canReview ? (
                  <div className="mt-2">
                    <ActionForm action={reviewAsset} submitLabel="Guardar decisión">
                      <input type="hidden" name="assetId" value={asset.id} />
                      <div className="flex flex-wrap gap-3">
                        <Field label="Estado de derechos">
                          <Select
                            name="rightsStatus"
                            options={RIGHTS_STATUS_OPTIONS}
                            defaultValue={asset.rights_status}
                          />
                        </Field>
                        <Field label="Licencia">
                          <Select
                            name="licenseId"
                            options={licenseOptions}
                            defaultValue={asset.license_id ?? ""}
                          />
                        </Field>
                        <Field label="Nota">
                          <TextInput
                            name="note"
                            maxLength={1000}
                            defaultValue={asset.rights_note}
                          />
                        </Field>
                      </div>
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {canUpload ? (
        <div className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="font-medium">Subir un activo</h2>
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
            Máximo 200 MB. Queda pendiente de revisión hasta que un revisor de derechos lo autorice.
          </p>
          <AssetUploadForm />
        </div>
      ) : null}

      <div>
        <h2 className="font-medium">Licencias</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid="licenses">
          {(licenses ?? []).map((license) => (
            <li key={license.id}>
              <strong>{license.licensor}</strong>: {license.scope} · {license.territory} ·{" "}
              {license.allowed_platforms.join(", ")} ·{" "}
              {license.commercial_allowed ? "uso comercial" : "sin uso comercial"} · hasta{" "}
              {license.expires_at ? formatDateTime(license.expires_at) : "sin fecha de fin"}
            </li>
          ))}
        </ul>
      </div>

      {canReview ? (
        <div className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Nueva licencia</h2>
          <ActionForm action={createLicense} submitLabel="Guardar licencia" testId="new-license">
            <Field label="Titular que concede">
              <TextInput name="licensor" required maxLength={200} />
            </Field>
            <Field label="Qué permite">
              <TextInput name="scope" required minLength={3} maxLength={2000} />
            </Field>
            <Field label="Transformaciones permitidas">
              <TextInput name="allowedTransformations" maxLength={1000} />
            </Field>
            <Field label="Territorio">
              <TextInput name="territory" required maxLength={200} defaultValue="Mundial" />
            </Field>
            <fieldset className="flex gap-4 text-sm">
              <legend className="mb-1">Plataformas</legend>
              {PLATFORM_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-1">
                  <input type="checkbox" name="allowedPlatforms" value={option.value} />
                  {option.label}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="commercialAllowed" />
              Permite uso comercial
            </label>
            <div className="flex gap-3">
              <Field label="Desde">
                <TextInput name="validFrom" type="date" />
              </Field>
              <Field label="Hasta">
                <TextInput name="expiresAt" type="date" />
              </Field>
            </div>
            <Field label="URL de las condiciones (https, opcional)">
              <TextInput name="termsUrl" type="url" maxLength={2000} />
            </Field>
            <Field label="Notas">
              <TextInput name="notes" maxLength={2000} />
            </Field>
          </ActionForm>
        </div>
      ) : null}
    </section>
  );
}
