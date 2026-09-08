'use client';

import { useRef, useState, type ComponentPropsWithoutRef } from 'react';

/**
 * Replaces every `<pre>` MDX/rehype-pretty-code emits. Reads the code
 * back out via `innerText` at click time rather than trying to recover
 * plain text from the already-highlighted `<span>` tree: that works
 * regardless of how Shiki tokenized the block, and needs no coordination
 * with the compiler.
 */
export function Pre(props: ComponentPropsWithoutRef<'pre'>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    const pre = wrapRef.current?.querySelector('pre');
    if (!pre) return;
    void navigator.clipboard.writeText(pre.innerText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div ref={wrapRef} className="code-block">
      <button type="button" className="code-block-copy" onClick={onCopy} aria-label="Copy code">
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre {...props} />
    </div>
  );
}
