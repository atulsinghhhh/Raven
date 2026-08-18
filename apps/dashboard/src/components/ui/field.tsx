import { InputHTMLAttributes } from 'react';

export function Field({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      />
    </div>
  );
}
