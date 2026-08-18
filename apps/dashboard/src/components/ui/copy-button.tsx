'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Copy-to-clipboard with inline confirmation. The label doubles as the
 * accessible name so screen readers announce the state change too, not
 * just the icon swap.
 */
export function CopyButton({
  value,
  label = 'Copy',
  iconOnly = false,
  className = '',
}: {
  value: string;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Without this, copying and then unmounting (e.g. navigating away from a
  // detail page) sets state on a dead component.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // Clipboard denied (insecure origin, permissions) — stay silent rather than fake success.
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied to clipboard' : `${label} to clipboard`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-surface px-2 py-1 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-fg ${className}`}
    >
      <span aria-hidden="true" className={copied ? 'text-success-text' : ''}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </span>
      {!iconOnly && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 3v5A1.5 1.5 0 004 9.5h.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8.5l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
