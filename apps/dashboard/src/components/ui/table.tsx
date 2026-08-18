/**
 * Table primitives. Dense by default — an infrastructure console is read
 * by scanning many rows, so row height stays tight and the type stays
 * small rather than turning every record into a card.
 *
 * On narrow screens callers render <MobileList> instead of shrinking the
 * table; a horizontally scrolling 7-column table is unusable on a phone.
 */

export function TableWrap({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-line bg-surface ${className}`}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <table className={`w-full border-collapse text-sm ${className}`}>{children}</table>;
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-line bg-surface-sunken">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  className = '',
  align = 'left',
}: {
  children?: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap text-muted ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({
  children,
  className = '',
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <tr className={`${interactive ? 'transition-colors hover:bg-surface-raised' : ''} ${className}`}>{children}</tr>
  );
}

export function TD({
  children,
  className = '',
  align = 'left',
}: {
  children?: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  return (
    <td className={`px-4 py-2.5 align-middle ${align === 'right' ? 'text-right' : ''} ${className}`}>{children}</td>
  );
}

/** Card-per-record layout used in place of the table below `sm`. */
export function MobileList({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

export function MobileRow({ children, href }: { children: React.ReactNode; href?: string }) {
  const inner = <div className="rounded-lg border border-line bg-surface p-3.5">{children}</div>;
  return (
    <li>
      {href ? (
        <a href={href} className="block transition-colors hover:opacity-90">
          {inner}
        </a>
      ) : (
        inner
      )}
    </li>
  );
}

export function MobileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-fg">{children}</span>
    </div>
  );
}
