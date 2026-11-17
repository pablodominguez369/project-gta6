import { formatScheduleWindows, proposeSlots, scheduleWindowsSchema } from "@gta6/domain";

import { ActionForm } from "@/components/action-form";
import { Field, Select, TextInput } from "@/components/field";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { saveScheduleRule } from "./actions";

const LOOKAHEAD_DAYS = 7;
const WEEKDAY = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "UTC" });

function weekdayOf(localDate: string): string {
  return WEEKDAY.format(new Date(`${localDate}T12:00:00Z`));
}

export default async function CalendarPage() {
  const user = await requireRole("member");
  const isAdmin = user.roles.includes("admin");
  const supabase = await createSupabaseServerClient();
  const now = new Date();

  const [{ data: channels }, { data: publications }] = await Promise.all([
    supabase
      .from("channels")
      .select(
        "id, display_name, platform, paused, max_posts_per_day, min_minutes_between_posts, schedule_rules(timezone, windows_json, approval_mode, enabled)",
      )
      .order("display_name"),
    supabase
      .from("publications")
      .select("channel_id, scheduled_at, published_at")
      .or(
        `scheduled_at.gte.${new Date(now.getTime() - 86_400_000).toISOString()},published_at.gte.${new Date(now.getTime() - 86_400_000).toISOString()}`,
      )
      .limit(500),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Calendario editorial</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Huecos propuestos para los próximos {LOOKAHEAD_DAYS} días, en la hora local de cada canal.
        Respetan el máximo de publicaciones por día y el tiempo mínimo entre ellas. El calendario no
        publica nada.
      </p>
      {(channels ?? []).map((channel) => {
        const rule = channel.schedule_rules;
        const windows = scheduleWindowsSchema.safeParse(rule?.windows_json ?? []);
        const taken = (publications ?? [])
          .filter((p) => p.channel_id === channel.id)
          .flatMap((p) => [p.scheduled_at, p.published_at])
          .filter((value): value is string => value !== null)
          .map((value) => new Date(value));
        const slots =
          rule?.enabled && windows.success
            ? proposeSlots({
                windows: windows.data,
                timezone: rule.timezone,
                now,
                days: LOOKAHEAD_DAYS,
                maxPostsPerDay: channel.max_posts_per_day,
                minMinutesBetweenPosts: channel.min_minutes_between_posts,
                taken,
              })
            : [];
        return (
          <div
            key={channel.id}
            className="rounded border border-neutral-200 p-4 dark:border-neutral-800"
            data-testid={`calendar-${channel.id}`}
          >
            <h2 className="font-medium">
              {channel.display_name}{" "}
              <span className="text-sm font-normal text-neutral-500">
                ({channel.platform}
                {channel.paused ? ", en pausa" : ""} · máx. {channel.max_posts_per_day}/día, cada{" "}
                {channel.min_minutes_between_posts} min)
              </span>
            </h2>
            {!rule?.enabled ? (
              <p className="mt-1 text-sm">Calendario desactivado.</p>
            ) : slots.length === 0 ? (
              <p className="mt-1 text-sm">No hay huecos en los próximos días.</p>
            ) : (
              <ul className="mt-2 list-disc pl-5 text-sm" data-testid="slots">
                {slots.map((slot) => (
                  <li key={slot.startsAt.toISOString()}>
                    {weekdayOf(slot.localDate)} {slot.localDate}, {slot.localTime} ({rule.timezone})
                  </li>
                ))}
              </ul>
            )}
            {isAdmin ? (
              <div className="mt-3">
                <ActionForm action={saveScheduleRule} submitLabel="Guardar calendario">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <div className="flex flex-wrap gap-4">
                    <Field label="Zona horaria">
                      <TextInput name="timezone" defaultValue={rule?.timezone ?? "Europe/Madrid"} />
                    </Field>
                    <Field label="Modo">
                      <Select
                        name="approvalMode"
                        defaultValue={rule?.approval_mode ?? "approval"}
                        options={[
                          { value: "approval", label: "Con aprobación" },
                          { value: "manual", label: "Manual" },
                        ]}
                      />
                    </Field>
                  </div>
                  <Field label="Ventanas (una por línea, ej.: lun 09:00-11:30)">
                    <textarea
                      name="windows"
                      rows={4}
                      defaultValue={windows.success ? formatScheduleWindows(windows.data) : ""}
                      className="rounded border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? false} />
                    Activado
                  </label>
                </ActionForm>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
