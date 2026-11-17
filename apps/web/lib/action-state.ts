/** Result shape returned by every server action to its form. */
export interface ActionState {
  readonly status: "idle" | "ok" | "error";
  readonly message: string | null;
}

export const IDLE: ActionState = { status: "idle", message: null };

export function actionOk(message: string): ActionState {
  return { status: "ok", message };
}

export function actionError(message: string): ActionState {
  return { status: "error", message };
}
