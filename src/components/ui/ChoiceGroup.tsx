import { useId } from 'react';

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/** Radio group drawn as large tappable cards; a native fieldset + radios underneath. */
export function ChoiceGroup<T extends string>({
  id,
  legend,
  hint,
  error,
  name,
  choices,
  value,
  onChange,
  columns = 2,
}: {
  id?: string;
  legend: string;
  hint?: string;
  error?: string;
  name: string;
  choices: Choice<T>[];
  value: T | null;
  onChange(value: T): void;
  columns?: 1 | 2;
}) {
  const baseId = useId();
  const hintId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;

  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      className="flex flex-col gap-2 focus:outline-none"
    >
      <legend className="mb-1 text-lg font-semibold">{legend}</legend>
      {hint && (
        <p id={hintId} className="text-sm text-slate-700">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      <div className={`grid gap-2 ${columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
        {choices.map((c) => (
          <label
            key={c.value}
            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border-2 bg-white px-3 py-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-700 has-checked:border-brand-700 has-checked:bg-brand-50 ${error ? 'border-red-700' : 'border-slate-300'}`}
          >
            <input
              type="radio"
              name={name}
              value={c.value}
              checked={value === c.value}
              onChange={() => onChange(c.value)}
              className="mt-1 size-5 shrink-0 accent-brand-700"
            />
            <span className="flex flex-col">
              <span className="font-medium text-slate-900">{c.label}</span>
              {c.description && <span className="text-sm text-slate-700">{c.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
