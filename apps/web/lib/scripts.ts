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

export const REQUEST_STATUS_LABELS: Readonly<Record<string, string>> = {
  queued: "En cola",
  running: "Redactando…",
  succeeded: "Listo",
  blocked: "En espera",
  failed: "No se pudo",
};

/** Why an AI draft did not happen, in plain words. */
export const REQUEST_ERROR_LABELS: Readonly<Record<string, string>> = {
  SPEND_LIMIT_REACHED:
    "El límite de gasto es 0 o ya se ha alcanzado. Un admin puede subirlo en «Controles».",
  FORBIDDEN: "La IA está desactivada en el servidor.",
  CONTENT_REFUSED: "El proveedor de IA rechazó la petición.",
  VALIDATION_FAILED:
    "No hay afirmaciones verificadas con fuentes suficientes, o la IA no devolvió un guion válido.",
  RATE_LIMITED: "El proveedor de IA pide esperar. Se reintentará solo.",
  EXTERNAL_UNAVAILABLE: "El proveedor de IA no responde. Se reintentará solo.",
  AMBIGUOUS_EXTERNAL_STATE: "La respuesta tardó demasiado. Se reintentará solo.",
  CREDENTIAL_EXPIRED: "La clave del proveedor de IA no es válida.",
};
