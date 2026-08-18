'use client';

import { useState } from 'react';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied to clipboard' : `${label} to clipboard`}
      className="inline-flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
