import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminHomePage() {
  await requireRole("member");
  const supabase = await createSupabaseServerClient();
  const { data: controls } = await supabase
    .from("system_controls")
    .select("global_paused, paused_reason")
    .maybeSingle<{ global_paused: boolean; paused_reason: string | null }>();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Resumen</h1>
      <div className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Estado del sistema</p>
        <p className="text-lg font-medium" data-testid="global-status">
          {controls?.global_paused
            ? "En pausa global"
            : "Activo (modo Draft, publicación simulada)"}
        </p>
        {controls?.global_paused && controls.paused_reason ? (
          <p className="text-sm">Motivo: {controls.paused_reason}</p>
        ) : null}
      </div>
    </section>
  );
}
