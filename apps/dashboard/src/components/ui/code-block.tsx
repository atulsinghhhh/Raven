'use client';

import { useId, useState } from 'react';
import { CopyButton } from './copy-button';

/**
 * Deliberately a ~60-line tokenizer instead of Shiki/Prism. Snippets here
 * are short and come from a fixed set of languages, and a highlighter
 * dependency would cost more bundle than every other page combined.
 * Tokens render as React nodes: no dangerouslySetInnerHTML anywhere.
 */
type TokenType = 'comment' | 'string' | 'keyword' | 'number' | 'function' | 'property' | 'punct' | 'plain';

const KEYWORDS: Record<string, string[]> = {
  typescript: [
    'import',
    'from',
    'export',
    'const',
    'let',
    'var',
    'function',
    'async',
    'await',
    'return',
    'if',
    'else',
    'for',
    'while',
    'new',
    'class',
    'extends',
    'interface',
    'type',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'default',
    'of',
    'in',
    'as',
    'void',
    'null',
    'undefined',
    'true',
    'false',
  ],
  javascript: [
    'import',
    'from',
    'export',
    'const',
    'let',
    'var',
    'function',
    'async',
    'await',
    'return',
    'if',
    'else',
    'for',
    'while',
    'new',
    'class',
    'extends',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'default',
    'of',
    'in',
    'void',
    'null',
    'undefined',
    'true',
    'false',
  ],
  python: [
    'import',
    'from',
    'def',
    'class',
    'return',
    'if',
    'elif',
    'else',
    'for',
    'while',
    'with',
    'as',
    'try',
    'except',
    'finally',
    'raise',
    'async',
    'await',
    'lambda',
    'None',
    'True',
    'False',
    'in',
    'not',
    'and',
    'or',
    'print',
  ],
  bash: [
    'curl',
    'npm',
    'pnpm',
    'yarn',
    'pip',
    'export',
    'cd',
    'echo',
    'sudo',
    'apt',
    'brew',
    'git',
    'node',
    'python',
    'npx',
  ],
  json: ['true', 'false', 'null'],
  text: [],
};

const LINE_COMMENT: Record<string, string> = {
  typescript: '//',
  javascript: '//',
  python: '#',
  bash: '#',
};

function tokenize(code: string, lang: string): { text: string; type: TokenType }[] {
  const keywords = new Set(KEYWORDS[lang] ?? KEYWORDS.typescript);
  const lineComment = LINE_COMMENT[lang];
  const out: { text: string; type: TokenType }[] = [];

  // Order matters: comments and strings win over everything inside them.
  const pattern = new RegExp(
    [
      lineComment === '//' ? '\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*' : null,
      lineComment === '#' ? '#[^\\n]*' : null,
      '"(?:\\\\.|[^"\\\\])*"',
      "'(?:\\\\.|[^'\\\\])*'",
      '`(?:\\\\.|[^`\\\\])*`',
      '\\b\\d+(?:\\.\\d+)?\\b',
      '[A-Za-z_$][\\w$]*',
      '[{}()\\[\\];,.:]',
    ]
      .filter(Boolean)
      .join('|'),
    'g',
  );

  let last = 0;
  for (const m of code.matchAll(pattern)) {
    const text = m[0];
    const start = m.index!;
    if (start > last) out.push({ text: code.slice(last, start), type: 'plain' });
    last = start + text.length;

    let type: TokenType = 'plain';
    if (text.startsWith('//') || text.startsWith('/*') || (lineComment === '#' && text.startsWith('#'))) {
      type = 'comment';
    } else if (/^["'`]/.test(text)) {
      type = 'string';
    } else if (/^\d/.test(text)) {
      type = 'number';
    } else if (/^[A-Za-z_$]/.test(text)) {
      if (keywords.has(text)) type = 'keyword';
      else if (code[last] === '(') type = 'function';
      else if (code[start - 1] === '.') type = 'property';
    } else {
      type = 'punct';
    }
    out.push({ text, type });
  }
  if (last < code.length) out.push({ text: code.slice(last), type: 'plain' });
  return out;
}

const TOKEN_CLASS: Record<TokenType, string> = {
  comment: 'text-[#8a857e] italic',
  string: 'text-[oklch(0.78_0.13_150)]',
  keyword: 'text-[oklch(0.75_0.15_310)]',
  number: 'text-[oklch(0.8_0.12_60)]',
  function: 'text-[oklch(0.78_0.12_240)]',
  property: 'text-[oklch(0.85_0.06_200)]',
  punct: 'text-[#7d7872]',
  plain: '',
};

function Highlighted({ code, language }: { code: string; language: string }) {
  return (
    <>
      {tokenize(code, language).map((t, i) =>
        t.type === 'plain' ? (
          <span key={i}>{t.text}</span>
        ) : (
          <span key={i} className={TOKEN_CLASS[t.type]}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

export function CodeBlock({
  code,
  language = 'shell',
  filename,
}: {
  code: string;
  language?: string;
  filename?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-[#191a1b]">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-1.5">
        <span className="mono-label text-[11px] text-[#a8a29b]">{filename ?? language}</span>
        <CopyButton
          value={code}
          iconOnly
          className="border-white/12 bg-white/5 text-[#b5afa8] hover:border-white/25 hover:text-white"
        />
      </div>
      <pre className="overflow-x-auto p-3.5 text-xs leading-relaxed">
        <code className="font-mono text-[#f3efe9]">
          <Highlighted code={code} language={language} />
        </code>
      </pre>
    </div>
  );
}

export interface CodeSample {
  label: string;
  language: string;
  code: string;
}

/** Same snippet across languages: the tab set doubles as the language selector. */
export function CodeTabs({ samples, className = '' }: { samples: CodeSample[]; className?: string }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const sample = samples[active];

  return (
    <div className={className}>
      <div role="tablist" aria-label="Language" className="mb-2 flex flex-wrap gap-1">
        {samples.map((s, i) => (
          <button
            key={s.label}
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') setActive((i + 1) % samples.length);
              if (e.key === 'ArrowLeft') setActive((i - 1 + samples.length) % samples.length);
            }}
            className={`mono-label rounded-sm px-2.5 py-1 text-[11px] transition-colors ${
              i === active ? 'bg-surface-sunken text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel-${active}`} aria-labelledby={`${id}-tab-${active}`}>
        <CodeBlock code={sample.code} language={sample.language} />
      </div>
    </div>
  );
}
