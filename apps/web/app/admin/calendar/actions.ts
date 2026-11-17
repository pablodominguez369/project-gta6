"use server";

import { parseScheduleWindows } from "@gta6/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionState } from "@/lib/action-state";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ruleSchema = z.object({
  channelId: z.uuid(),
  timezone: z.string().trim().min(1).max(64),
  windows: z.string().max(5000),
  approvalMode: z.enum(["approval", "manual"]),
  enabled: z.boolean(),
});

/** An admin sets a channel's weekly windows. The calendar only proposes slots; it never publishes. */
export async function saveScheduleRule(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const parsed = ruleSchema.safeParse({
    channelId: formData.get("channelId"),
    timezone: formData.get("timezone"),
    windows: formData.get("windows") ?? "",
    approvalMode: formData.get("approvalMode"),
    enabled: formData.get("enabled") === "on",
  });
  if (!parsed.success) return actionError("Revisa la zona horaria y el modo.");
  const windows = parseScheduleWindows(parsed.data.windows);
  if (!windows.ok) {
    const line = windows.error.details.line;
    return actionError(
      `La línea ${String(line)} no es válida. Usa el formato «lun 09:00-11:30», una por línea.`,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("schedule_rules").upsert(
    {
      channel_id: parsed.data.channelId,
      timezone: parsed.data.timezone,
      windows_json: windows.value,
      approval_mode: parsed.data.approvalMode,
      enabled: parsed.data.enabled,
      created_by: user.id,
    },
    { onConflict: "channel_id" },
  );
  if (error?.code === "23514")
    return actionError("La zona horaria no existe (ej.: Europe/Madrid).");
  if (error) {
    logger.error({ dbErrorCode: error.code }, "schedule rule save failed");
    return actionError("No se pudo guardar el calendario.");
  }
  revalidatePath("/admin/calendar");
  return actionOk("Calendario guardado.");
}
