import { ActionForm } from "@/components/action-form";
import { Field, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { setGlobalPause } from "./actions";

export default async function ControlsPage() {
  await requireRole(["admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: controls } = await supabase
    .from("system_controls")
    .select(
      "global_paused, paused_reason, daily_spend_limit_eur, monthly_spend_limit_eur, updated_at",
    )
    .single();

  const paused = controls?.global_paused ?? false;

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Controles</h1>

      <div className="flex flex-col gap-3 rounded border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-medium">Pausa global</h2>
        <p className="text-sm" data-testid="global-pause-state">
          {paused ? `En pausa: ${controls?.paused_reason ?? "sin motivo"}` : "Activo"}
        </p>
        <p className="text-xs text-neutral-500">
          Última modificación: {formatDateTime(controls?.updated_at ?? null)}
        </p>
        {paused ? (
          <ActionForm action={setGlobalPause} submitLabel="Reanudar sistema" testId="resume-form">
            <input type="hidden" name="paused" value="false" />
          </ActionForm>
        ) : (
          <ActionForm
            action={setGlobalPause}
            submitLabel="Pausa global"
            tone="danger"
            testId="pause-form"
          >
            <input type="hidden" name="paused" value="true" />
            <Field label="Motivo">
              <TextInput name="reason" required minLength={3} maxLength={500} />
            </Field>
          </ActionForm>
        )}
        <p className="text-xs text-neutral-500">
          Con la pausa activa ningún job de publicación se ejecuta; quedan bloqueados hasta
          reanudar.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-medium">Límites de gasto</h2>
        <p className="text-sm">
          Diario: {controls?.daily_spend_limit_eur ?? 0} € · Mensual:{" "}
          {controls?.monthly_spend_limit_eur ?? 0} €
        </p>
        <p className="text-xs text-neutral-500">
          Por defecto 0 € (no se permite gasto). Solo lectura en la Fase 1; el sistema nunca los
          eleva automáticamente.
        </p>
      </div>
    </section>
  );
}
