const DISPLAY_TIMEZONE = "Europe/Madrid";

/** Formats a UTC timestamp for the console in the operator's time zone. */
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: DISPLAY_TIMEZONE,
  }).format(new Date(value));
}
