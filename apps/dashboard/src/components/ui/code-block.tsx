import { CopyButton } from './copy-button';

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="relative rounded-md bg-neutral-950 text-neutral-100 text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800">
        <span className="text-neutral-500">{language ?? 'shell'}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto p-3">
        <code>{code}</code>
      </pre>
    </div>
  );
}
