import { requireRole } from "@/lib/auth/require-role";

// Admin-only. Pause and limit controls are added in T7.
export default async function ControlsPage() {
  await requireRole(["admin"]);

  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Controles</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Pausa global, pausa por canal y límites. Disponible en la siguiente tarea.
      </p>
    </section>
  );
}
