import { PLATFORMS, SELECTABLE_CHANNEL_MODES } from "@gta6/domain";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { oauthConfigured } from "@/lib/oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  createChannel,
  disconnectChannelAccount,
  setChannelPause,
  setLiveUploads,
} from "./actions";

/** Result of connecting an account, shown after the OAuth redirect. */
const OAUTH_MESSAGES: Record<string, string> = {
  connected: "Cuenta conectada. Sus permisos se guardan cifrados; nadie puede verlos.",
  denied: "La conexión se canceló en la plataforma.",
  invalid_state: "La conexión caducó o no se inició desde aquí. Vuelve a intentarlo.",
  not_configured: "Falta configurar la app de desarrollador de esta plataforma.",
  unsupported: "Esta plataforma no se conecta en la Fase 4 (solo modo manual).",
  failed: "No se pudo completar la conexión. Vuelve a intentarlo.",
};

const CREDENTIAL_LABELS: Record<string, string> = {
  active: "Conectada",
  expired: "Caducada: vuelve a conectar",
  pending: "Pendiente",
};

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("member");
  const isAdmin = user.roles.includes("admin");
  const oauthResult = (await searchParams).oauth;
  const oauthMessage = typeof oauthResult === "string" ? OAUTH_MESSAGES[oauthResult] : undefined;
  const supabase = await createSupabaseServerClient();
  const [{ data: channels }, { data: credentials }] = await Promise.all([
    supabase
      .from("channels")
      .select(
        "id, platform, display_name, mode, paused, paused_reason, timezone, max_posts_per_day, min_minutes_between_posts, live_uploads_enabled",
      )
      .order("created_at", { ascending: true }),
    // Admins only (RLS); other roles get an empty list.
    supabase.from("credential_refs").select("channel_id, status").neq("status", "revoked"),
  ]);
  const credentialOf = new Map((credentials ?? []).map((c) => [c.channel_id, c.status]));

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Canales</h1>
      {oauthMessage ? (
        <p
          role="status"
          className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800"
        >
          {oauthMessage}
        </p>
      ) : null}

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
              {isAdmin ? <th className="py-2 pr-4">Cuenta y subidas</th> : null}
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
                  <td className="py-2 pr-4" data-testid={`account-${channel.id}`}>
                    <AccountCell
                      channelId={channel.id}
                      platform={channel.platform}
                      credential={credentialOf.get(channel.id) ?? null}
                      liveUploadsEnabled={channel.live_uploads_enabled}
                    />
                  </td>
                ) : null}
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
            Autopublish no está disponible. Nada se publica en público: YouTube y TikTok solo suben
            en privado cuando conectas la cuenta y activas las subidas; Instagram, solo en modo
            manual.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function AccountCell({
  channelId,
  platform,
  credential,
  liveUploadsEnabled,
}: {
  readonly channelId: string;
  readonly platform: string;
  readonly credential: string | null;
  readonly liveUploadsEnabled: boolean;
}) {
  if (platform === "simulated") return <span>—</span>;
  if (platform === "instagram") {
    return <span>Solo manual (Instagram no tiene subida privada)</span>;
  }
  const configured = oauthConfigured(platform);
  return (
    <div className="flex flex-col gap-2">
      <span>{credential ? (CREDENTIAL_LABELS[credential] ?? credential) : "Sin conectar"}</span>
      {configured ? (
        <a href={`/admin/channels/${channelId}/connect`} className="underline">
          {credential ? "Volver a conectar" : "Conectar cuenta"}
        </a>
      ) : (
        <span className="text-xs text-neutral-500">Falta la app de desarrollador</span>
      )}
      {credential ? (
        <ActionForm action={disconnectChannelAccount} submitLabel="Desconectar" tone="danger">
          <input type="hidden" name="channelId" value={channelId} />
        </ActionForm>
      ) : null}
      {credential === "active" || liveUploadsEnabled ? (
        <ActionForm
          action={setLiveUploads}
          submitLabel={liveUploadsEnabled ? "Desactivar subidas" : "Activar subidas privadas"}
          tone={liveUploadsEnabled ? "danger" : "default"}
        >
          <input type="hidden" name="channelId" value={channelId} />
          <input type="hidden" name="enabled" value={liveUploadsEnabled ? "false" : "true"} />
          {liveUploadsEnabled ? null : (
            <TextInput
              name="reason"
              placeholder="Motivo (queda en auditoría)"
              aria-label="Motivo para activar subidas"
              required
              minLength={3}
            />
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}
