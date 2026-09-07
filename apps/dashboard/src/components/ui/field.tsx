import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/*
 * One control style for every input, select and textarea. Flat: a
 * hairline border that strengthens on hover and turns accent on focus,
 * and no inner shadow — same treatment as the buttons next to them.
 *
 * Field labels are mono-uppercase to match the table headers and stat
 * labels, so every piece of chrome in the console speaks with one voice
 * and the sans text on a page is reliably content.
 */
const CONTROL =
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle transition-colors hover:border-line-strong focus:border-accent disabled:opacity-60';

const LABEL = 'mono-label text-[11px] text-muted';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} h-9 ${className}`} />;
}

export function Field({
  label,
  id,
  hint,
  error,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string; error?: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        {...props}
        className={`${CONTROL} h-9 ${error ? 'border-danger-line' : ''}`}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextareaField({
  label,
  id,
  hint,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <textarea
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
        className={`${CONTROL} min-h-[72px] resize-y py-2 leading-relaxed`}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  id,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; id: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
      )}
      <select id={id} {...props} className={`${CONTROL} h-9 cursor-pointer appearance-none pr-8`}>
        {children}
      </select>
    </div>
  );
}
