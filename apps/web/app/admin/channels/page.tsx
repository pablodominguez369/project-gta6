import { PLATFORMS, SELECTABLE_CHANNEL_MODES } from "@gta6/domain";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createChannel, setChannelPause } from "./actions";

export default async function ChannelsPage() {
  const user = await requireRole("member");
  const isAdmin = user.roles.includes("admin");
  const supabase = await createSupabaseServerClient();
  const { data: channels } = await supabase
    .from("channels")
    .select(
      "id, platform, display_name, mode, paused, paused_reason, timezone, max_posts_per_day, min_minutes_between_posts",
    )
    .order("created_at", { ascending: true });

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Canales</h1>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-2 pr-4">Nombre</th>
              <th className="py-2 pr-4">Plataforma</th>
              <th className="py-2 pr-4">Modo</th>
              <th className="py-2 pr-4">Zona horaria</th>
              <th className="py-2 pr-4">Límites</th>
              <th className="py-2 pr-4">Estado</th>
              {isAdmin ? <th className="py-2">Acción</th> : null}
            </tr>
          </thead>
          <tbody>
            {(channels ?? []).map((channel) => (
              <tr
                key={channel.id}
                className="border-t border-neutral-200 align-top dark:border-neutral-800"
                data-testid={`channel-${channel.id}`}
              >
                <td className="py-2 pr-4">{channel.display_name}</td>
                <td className="py-2 pr-4">{channel.platform}</td>
                <td className="py-2 pr-4">{channel.mode}</td>
                <td className="py-2 pr-4">{channel.timezone}</td>
                <td className="py-2 pr-4">
                  {channel.max_posts_per_day}/día · {channel.min_minutes_between_posts} min
                </td>
                <td className="py-2 pr-4">
                  {channel.paused
                    ? `En pausa (${channel.paused_reason ?? "sin motivo"})`
                    : "Activo"}
                </td>
                {isAdmin ? (
                  <td className="py-2">
                    <ActionForm
                      action={setChannelPause}
                      submitLabel={channel.paused ? "Reanudar" : "Pausar"}
                      tone={channel.paused ? "default" : "danger"}
                    >
                      <input type="hidden" name="channelId" value={channel.id} />
                      <input
                        type="hidden"
                        name="paused"
                        value={channel.paused ? "false" : "true"}
                      />
                      {channel.paused ? null : (
                        <TextInput
                          name="reason"
                          placeholder="Motivo"
                          aria-label="Motivo de la pausa"
                          required
                          minLength={3}
                        />
                      )}
                    </ActionForm>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin ? (
        <div className="max-w-md rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Nuevo canal</h2>
          <ActionForm action={createChannel} submitLabel="Crear canal">
            <Field label="Nombre">
              <TextInput name="displayName" required maxLength={100} />
            </Field>
            <Field label="Plataforma">
              <Select
                name="platform"
                defaultValue="simulated"
                options={PLATFORMS.map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field label="Modo">
              <Select
                name="mode"
                defaultValue="draft"
                options={SELECTABLE_CHANNEL_MODES.map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field label="Zona horaria (IANA)">
              <TextInput name="timezone" defaultValue="Europe/Madrid" required />
            </Field>
            <Field label="Máximo de publicaciones por día">
              <TextInput name="maxPostsPerDay" type="number" min={0} max={50} defaultValue={1} />
            </Field>
            <Field label="Minutos mínimos entre publicaciones">
              <TextInput name="minMinutesBetweenPosts" type="number" min={0} defaultValue={120} />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-neutral-500">
            Autopublish no está disponible en la Fase 1. Ningún canal publica contenido real.
          </p>
        </div>
      ) : null}
    </section>
  );
}
