import type { InputHTMLAttributes, ReactNode } from "react";

const INPUT_CLASS =
  "rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={INPUT_CLASS} />;
}

export function Select({
  name,
  options,
  defaultValue,
  placeholder,
}: {
  readonly name: string;
  readonly options: readonly { value: string; label: string }[];
  readonly defaultValue?: string;
  /** Shown first with an empty value, so nothing is chosen until the person picks. */
  readonly placeholder?: string;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? (placeholder ? "" : undefined)}
      className={INPUT_CLASS}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
