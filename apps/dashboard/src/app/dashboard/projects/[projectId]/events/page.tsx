import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { IconEvents } from '@/components/ui/icons';
import { formatDateTime } from '@/lib/format';
import { buildLogEntries, type LogProduct, type LogStatus } from '@/lib/logs';
import { fetchLogSources, LOG_SCAN_LIMIT } from '@/lib/log-sources';
import { LogFilters } from '../logs/log-filters';

/**
 * Same merged sources as Logs, presented as raw structured records
 * instead of a table: for pasting into an issue, a support thread, or
 * a debugger. Every payload is the real object the Control API already
 * returned elsewhere in this app; nothing is reshaped to look more
 * "event-like" than it is.
 */
export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ product?: string; status?: string; q?: string }>;
}) {
  const { projectId } = await params;
  const { product: rawProduct, status: rawStatus, q } = await searchParams;
  const product = (['rtc', 'chat', 'webhook', 'audit'] as const).includes(rawProduct as LogProduct)
    ? (rawProduct as LogProduct)
    : undefined;
  const status = (['success', 'failed'] as const).includes(rawStatus as LogStatus) ? (rawStatus as LogStatus) : undefined;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  const sources = await fetchLogSources(token, projectId);
  if (sources.unauthorized instanceof ApiError && sources.unauthorized.status === 401) redirect('/login');

  const allEntries = buildLogEntries(base, sources);

  const filtered = allEntries.filter((e) => {
    if (product && e.product !== product) return false;
    if (status && e.status !== status) return false;
    if (q) {
      const needle = q.toLowerCase();
      if (!e.event.toLowerCase().includes(needle) && !(e.requestId ?? '').toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Events"
        description={`Structured JSON for the ${LOG_SCAN_LIMIT} most recent RTC connections, errors, chat sessions, webhook deliveries, and audit entries. Never includes an API key secret, webhook signing secret, or chat message content — none of those are part of these records.`}
      />

      <LogFilters basePath={`${base}/events`} product={product} status={status} q={q} />

      {filtered.length === 0 ? (
        sources.anySourceFailed ? (
          <ErrorState title="Some event sources are unreachable" description="Try again in a moment — this doesn't affect stored data." />
        ) : (
          <EmptyState
            icon={<IconEvents className="size-7" />}
            title="No events yet"
            description="Once a client connects, a message sends, or a webhook fires, it appears here automatically."
          />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone="neutral" glyph={false}>
                    {entry.product}
                  </Badge>
                  <a href={entry.href} className="truncate font-mono text-xs text-fg hover:underline">
                    {entry.event}
                  </a>
                  <Badge tone={entry.status === 'success' ? 'success' : 'danger'} glyph={false}>
                    {entry.status === 'success' ? 'SUCCESS' : 'FAILED'}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-xs text-subtle">{formatDateTime(entry.timestamp)}</span>
                  <CopyButton value={JSON.stringify(entry.payload, null, 2)} label="Copy JSON" />
                </div>
              </div>
              <pre className="overflow-x-auto p-4 text-[0.8125rem] leading-relaxed">
                <code className="font-mono text-fg">{JSON.stringify(entry.payload, null, 2)}</code>
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
