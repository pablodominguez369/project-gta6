"use client";

import { useActionState, type ReactNode } from "react";

import { IDLE, type ActionState } from "@/lib/action-state";

interface ActionFormProps {
  readonly action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  readonly submitLabel: string;
  readonly pendingLabel?: string;
  readonly tone?: "default" | "danger";
  readonly children?: ReactNode;
  readonly testId?: string;
}

/** Form bound to a server action, with pending state and an accessible result message. */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = "Guardando…",
  tone = "default",
  children,
  testId,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const buttonClass =
    tone === "danger"
      ? "bg-red-600 text-white"
      : "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900";

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid={testId}>
      {children}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`rounded px-4 py-2 text-sm font-medium disabled:opacity-60 ${buttonClass}`}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        {state.message ? (
          <p
            role="status"
            className={`text-sm ${state.status === "error" ? "text-red-600" : "text-green-700 dark:text-green-400"}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
