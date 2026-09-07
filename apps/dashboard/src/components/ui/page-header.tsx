/**
 * The page title block. The heading runs light and tightly tracked
 * rather than semibold — the same restraint the marketing site's
 * headlines use, one step heavier so it still holds at 22px against a
 * dense page of tables.
 *
 * `eyebrow` is the mono-uppercase kicker above the title. It's optional
 * and sits below `breadcrumb` when both are present, since the
 * breadcrumb is navigation and the eyebrow is a label for where you
 * already are.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  meta,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; href: string };
  meta?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="flex flex-col gap-3">
      {breadcrumb && (
        <a
          href={breadcrumb.href}
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M10 3.5L5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {breadcrumb.label}
        </a>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && <span className="mono-label mb-2 block text-[11px] text-muted">{eyebrow}</span>}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display truncate text-[1.375rem] text-fg">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
