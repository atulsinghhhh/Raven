import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { IconLogs } from '@/components/ui/icons';
import { formatDateTime } from '@/lib/format';
import { buildLogEntries, type LogProduct, type LogStatus } from '@/lib/logs';
import { fetchLogSources, LOG_SCAN_LIMIT } from '@/lib/log-sources';
import { LogFilters } from './log-filters';

export default async function LogsPage({
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
  const status = (['success', 'failed'] as const).includes(rawStatus as LogStatus)
    ? (rawStatus as LogStatus)
    : undefined;

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

  const failedCount = filtered.filter((e) => e.status === 'failed').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Logs"
        description={`A merged, read-only view of RTC connections, errors, chat sessions, webhook deliveries, and audit activity — the ${LOG_SCAN_LIMIT} most recent of each, newest first. Click a row to open its real record.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Shown" value={filtered.length} hint={`Of ${allEntries.length} fetched`} />
        <StatCard label="Failed" value={failedCount} tone={failedCount > 0 ? 'warning' : 'default'} />
        <StatCard label="Webhooks scanned" value={sources.webhooksScanned} hint={`Of ${sources.webhooksTotal} total`} />
        <StatCard
          label="Sources"
          value={sources.anySourceFailed ? 'Partial' : 'All reachable'}
          tone={sources.anySourceFailed ? 'warning' : 'success'}
        />
      </div>

      <LogFilters basePath={`${base}/logs`} product={product} status={status} q={q} />

      {filtered.length === 0 ? (
        sources.anySourceFailed ? (
          <ErrorState
            title="Some log sources are unreachable"
            description="Try again in a moment — this doesn't affect stored data."
          />
        ) : (
          <EmptyState
            icon={<IconLogs className="size-7" />}
            title="No log entries yet"
            description="Once a client connects, a message sends, or a webhook fires, it appears here automatically."
          />
        )
      ) : (
        <>
          <TableWrap className="hidden sm:block">
            <Table>
              <THead>
                <TH>Time</TH>
                <TH>Product</TH>
                <TH>Event</TH>
                <TH>Status</TH>
                <TH>Details</TH>
              </THead>
              <TBody>
                {filtered.map((entry) => (
                  <TR key={entry.id} interactive>
                    <TD>
                      <a href={entry.href} className="tabular block text-fg hover:underline">
                        {formatDateTime(entry.timestamp)}
                      </a>
                    </TD>
                    <TD>
                      <Badge tone="neutral" glyph={false}>
                        {entry.product}
                      </Badge>
                    </TD>
                    <TD>
                      <a href={entry.href} className="block font-mono text-xs text-fg hover:underline">
                        {entry.event}
                      </a>
                    </TD>
                    <TD>
                      <Badge tone={entry.status === 'success' ? 'success' : 'danger'} glyph={false}>
                        {entry.status === 'success' ? 'SUCCESS' : 'FAILED'}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="block truncate text-muted">{entry.summary}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>

          <div className="sm:hidden">
            <MobileList>
              {filtered.map((entry) => (
                <MobileRow key={entry.id} href={entry.href}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-fg">{entry.event}</span>
                    <Badge tone={entry.status === 'success' ? 'success' : 'danger'} glyph={false}>
                      {entry.status === 'success' ? 'SUCCESS' : 'FAILED'}
                    </Badge>
                  </div>
                  <MobileField label="When">{formatDateTime(entry.timestamp)}</MobileField>
                  <MobileField label="Details">{entry.summary}</MobileField>
                </MobileRow>
              ))}
            </MobileList>
          </div>
        </>
      )}
    </div>
  );
}
