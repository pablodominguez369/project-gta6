import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PAGE_SIZE = 100;

export default async function AuditPage() {
  await requireRole(["admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: events } = await supabase
    .from("audit_events")
    .select("id, created_at, actor_id, actor_type, action, object_type, object_id, safe_details")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Auditoría</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Últimos {PAGE_SIZE} eventos. El registro es de solo inserción: nadie puede editarlo ni
        borrarlo.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="audit-table">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Acción</th>
              <th className="py-2 pr-4">Actor</th>
              <th className="py-2 pr-4">Objeto</th>
              <th className="py-2">Detalles</th>
            </tr>
          </thead>
          <tbody>
            {(events ?? []).map((event) => (
              <tr
                key={event.id}
                className="border-t border-neutral-200 align-top dark:border-neutral-800"
              >
                <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(event.created_at)}</td>
                <td className="py-2 pr-4 font-mono">{event.action}</td>
                <td className="py-2 pr-4">
                  {event.actor_type}
                  {event.actor_id ? ` · ${event.actor_id.slice(0, 8)}` : ""}
                </td>
                <td className="py-2 pr-4">
                  {event.object_type}
                  {event.object_id ? ` · ${event.object_id.slice(0, 8)}` : ""}
                </td>
                <td className="py-2 font-mono text-xs break-all">
                  {JSON.stringify(event.safe_details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
