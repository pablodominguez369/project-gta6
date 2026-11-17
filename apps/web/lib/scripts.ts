/** Rows offered by the script editor form. Empty rows are ignored. */
export const EDITOR_ROWS = 8;

export const SCRIPT_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "Borrador",
  in_review: "En revisión",
  changes_requested: "Cambios pedidos",
  approved: "Aprobado",
  rejected: "Rechazado",
};

export const LINE_KIND_OPTIONS = [
  { value: "hook", label: "Gancho" },
  { value: "context", label: "Contexto" },
  { value: "body", label: "Desarrollo" },
  { value: "cta", label: "Cierre" },
] as const;

export const LOCALE_OPTIONS = [
  { value: "es-ES", label: "Español de España" },
  { value: "es-419", label: "Español latinoamericano" },
] as const;
