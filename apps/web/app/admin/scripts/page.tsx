import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { SCRIPT_STATUS_LABELS } from "@/lib/scripts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ScriptsPage() {
  await requireRole("member");
  const supabase = await createSupabaseServerClient();
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, version, status, updated_at, opportunities(topic)")
    .order("updated_at", { ascending: false })
    .limit(50);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Guiones</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Los guiones se crean desde una oportunidad aceptada. Cada línea cita afirmaciones con
        fuentes y otra persona los aprueba.
      </p>
      {(scripts ?? []).length === 0 ? <p className="text-sm">Todavía no hay guiones.</p> : null}
      <ul className="flex flex-col gap-2">
        {(scripts ?? []).map((script) => (
          <li key={script.id} className="text-sm">
            <Link href={`/admin/scripts/${script.id}`} className="underline">
              {script.opportunities.topic} · v{script.version}
            </Link>{" "}
            <span className="text-neutral-500">
              {SCRIPT_STATUS_LABELS[script.status] ?? script.status} ·{" "}
              {formatDateTime(script.updated_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
