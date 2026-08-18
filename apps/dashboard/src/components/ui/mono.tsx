import { Dash } from './states';
import { CopyButton } from './copy-button';

/**
 * Identifiers (conn_…, err_…, rvk_…, uuids) are monospace and truncate
 * from the tail — the prefix is what a developer recognises, so it must
 * never be the part that gets cut. `title` keeps the full value available
 * on hover, and copy gives them the exact string.
 */
export function MonoId({
  value,
  href,
  copy = false,
  className = '',
}: {
  value: string | null | undefined;
  href?: string;
  copy?: boolean;
  className?: string;
}) {
  if (!value) return <Dash />;

  const text = (
    <span title={value} className="truncate font-mono text-xs">
      {value}
    </span>
  );

  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 ${className}`}>
      {href ? (
        <a href={href} className="min-w-0 truncate text-accent-text hover:underline">
          {text}
        </a>
      ) : (
        text
      )}
      {copy && <CopyButton value={value} iconOnly label="Copy ID" />}
    </span>
  );
}

/** Label-over-value pair used across every detail page. */
export function KeyValue({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={`mt-1 truncate text-sm text-fg ${mono ? 'font-mono text-xs' : ''}`}>{children}</dd>
    </div>
  );
}

export function KeyValueGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <dl className={`grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 ${className}`}>{children}</dl>
  );
}
