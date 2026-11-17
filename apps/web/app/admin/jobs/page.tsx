import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function JobsPage() {
  await requireRole("member");
  const supabase = await createSupabaseServerClient();
  const { data: runs } = await supabase
    .from("job_runs")
    .select(
      "id, job_name, status, attempt, error_code, target_type, target_id, started_at, finished_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Jobs</h1>
      {runs && runs.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-2 pr-4">Job</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2 pr-4">Intento</th>
                <th className="py-2 pr-4">Error</th>
                <th className="py-2 pr-4">Inicio</th>
                <th className="py-2">Fin</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-2 pr-4 font-mono">{run.job_name}</td>
                  <td className="py-2 pr-4">{run.status}</td>
                  <td className="py-2 pr-4">{run.attempt}</td>
                  <td className="py-2 pr-4">{run.error_code ?? "—"}</td>
                  <td className="py-2 pr-4">{formatDateTime(run.started_at)}</td>
                  <td className="py-2">{formatDateTime(run.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Todavía no hay ejecuciones. Arranca el worker con{" "}
          <code>pnpm --filter @gta6/worker dev</code>.
        </p>
      )}
    </section>
  );
}
