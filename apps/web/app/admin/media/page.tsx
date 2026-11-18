import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { MEDIA_STATUS_LABELS } from "@/lib/media";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function MediaPage() {
  await requireRole("member");
  const supabase = await createSupabaseServerClient();
  const { data: projects } = await supabase
    .from("media_projects")
    .select("id, status, updated_at, scripts(version, opportunities(topic))")
    .order("updated_at", { ascending: false })
    .limit(50);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Vídeos</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Cada vídeo sale de un guion aprobado. Solo se usan activos y voces autorizados; si algo deja
        de estarlo, el vídeo se bloquea.
      </p>
      {(projects ?? []).length === 0 ? <p className="text-sm">Todavía no hay vídeos.</p> : null}
      <ul className="flex flex-col gap-2">
        {(projects ?? []).map((project) => (
          <li key={project.id} className="text-sm">
            <Link href={`/admin/media/${project.id}`} className="underline">
              {project.scripts.opportunities.topic} · guion v{project.scripts.version}
            </Link>{" "}
            <span className="text-neutral-500">
              {MEDIA_STATUS_LABELS[project.status] ?? project.status} ·{" "}
              {formatDateTime(project.updated_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
