import { ButtonLink } from './button';

/**
 * Empty states teach rather than report. Every one of these should leave
 * the developer knowing what to do next, so `description` is expected to
 * explain the mechanism and `action` to link to the thing that starts it.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
      {icon && <div className="mb-3 text-subtle">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * API failure UI. Shows a human explanation plus, when the API gave us
 * one, the request/error id to quote in a bug report: never a stack
 * trace or raw driver error.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  requestId,
  retryHref,
}: {
  title?: string;
  description?: React.ReactNode;
  requestId?: string;
  retryHref?: string;
}) {
  return (
    <div role="alert" className="rounded-lg border border-danger-line bg-danger-subtle p-5">
      <div className="flex gap-3">
        <span aria-hidden="true" className="mt-0.5 text-danger-text">
          <svg viewBox="0 0 16 16" className="size-4" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 8a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-danger-text">{title}</p>
          {description && <p className="mt-1 text-sm leading-relaxed text-danger-text/85">{description}</p>}
          {requestId && (
            <p className="mt-2 font-mono text-xs text-danger-text/70">
              <span className="font-sans">Request ID: </span>
              {requestId}
            </p>
          )}
          {retryHref && (
            <div className="mt-3">
              <ButtonLink href={retryHref} size="sm" variant="secondary">
                Retry
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Placeholder for a value we genuinely don't have. Deliberately never a
 * zero or a dash that could be mistaken for real data: an unreachable
 * dependency and an idle one must not look the same.
 */
export function NoDataYet({ label = 'No data yet' }: { label?: string }) {
  return <span className="text-sm text-subtle italic">{label}</span>;
}

/** Inline " " for a field that is legitimately empty on this record. */
export function Dash() {
  return (
    <span className="text-subtle" aria-label="Not set">
      —
    </span>
  );
}
