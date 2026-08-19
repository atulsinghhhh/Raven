'use client';

import { useState } from 'react';

/**
 * A single-file code panel — CodeSample's chrome (traffic-light dots,
 * filename bar) without the tab strip, for sections that show one
 * snippet rather than switching between several.
 */
export function CodeBlock({ filename, code }: { filename: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — nothing
      // to fall back to that wouldn't be worse than doing nothing.
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-raven-lg">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-2 font-mono text-xs text-subtle">{filename}</span>
        <button
          type="button"
          onClick={copy}
          className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-fg"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed">
        <code className="font-mono text-fg">{code}</code>
      </pre>
    </div>
  );
}
