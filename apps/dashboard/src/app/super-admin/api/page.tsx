import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { type ApiKeyStatus, type Environment, getApiOverview, listApiKeys } from '@/lib/super-admin/api-ops';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';

const PAGE_SIZE = 50;

const STATUS_TONE: Record<ApiKeyStatus, BadgeTone> = {
  ACTIVE: 'success',
  REVOKED: 'neutral',
};

const STATUS_LABEL: Record<ApiKeyStatus, string> = {
  ACTIVE: 'Active',
  REVOKED: 'Revoked',
};

const ENVIRONMENT_TONE: Record<Environment, BadgeTone> = {
  PRODUCTION: 'accent',
  STAGING: 'warning',
  DEVELOPMENT: 'neutral',
};

export default async function SuperAdminApiPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; status?: string; environment?: string }>;
}) {
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/api');

  const { offset: offsetParam, status, environment } = await searchParams;
  const offset = Math.max(Number.parseInt(offsetParam ?? '0', 10) || 0, 0);

  let overview;
  let keys;
  try {
    [overview, keys] = await Promise.all([
      getApiOverview(token),
      listApiKeys(token, {
        status: status as ApiKeyStatus | undefined,
        environment: environment as Environment | undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) redirect('/dashboard');
    return (
      <ErrorState
        title="Could not load API operations data"
        description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
        retryHref="/super-admin/api"
      />
    );
  }

  const hasPrevPage = offset > 0;
  const hasNextPage = offset + keys.items.length < keys.total;
  const rangeStart = keys.items.length === 0 ? 0 : offset + 1;
  const rangeEnd = offset + keys.items.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="API"
        eyebrow="Products"
        description="API key lifecycle and rate-limit activity, platform-wide — across every project."
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total keys" value={formatCount(overview.keys.total)} />
        <StatCard label="Active" value={formatCount(overview.keys.active)} tone="success" />
        <StatCard label="Revoked" value={formatCount(overview.keys.revoked)} />
        <StatCard label="Created today" value={formatCount(overview.keys.createdToday)} />
        <StatCard label="Created this week" value={formatCount(overview.keys.createdThisWeek)} />
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Keys created (activity log, today)"
          value={formatCount(overview.activity.apiKeyCreatedToday)}
          hint="From ActivityEvent, as a cross-check on the ApiKey table above"
        />
        <StatCard
          label="Keys revoked (activity log, today)"
          value={formatCount(overview.activity.apiKeyRevokedToday)}
        />
        <StatCard
          label="Failed requests today"
          value={formatCount(overview.activity.apiRequestFailedToday)}
          tone={overview.activity.apiRequestFailedToday > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Rate-limit events today"
          value={formatCount(overview.activity.rateLimitTriggeredToday)}
          hint={`${formatCount(overview.activity.rateLimitTriggeredTotal)} all-time`}
          tone={overview.activity.rateLimitTriggeredToday > 0 ? 'warning' : 'default'}
        />
      </section>

      <div className="rounded-lg border border-dashed border-line bg-surface-sunken p-4 text-sm leading-relaxed text-muted">
        <p className="font-medium text-fg">What this page can and can&apos;t show</p>
        <p className="mt-1.5">
          This codebase has no per-request log table — the request logger and metrics middleware only emit a log
          line and feed Prometheus counters, neither persists a row to Postgres. So this page cannot report API
          request volume, successful/failed request rates, 4xx/5xx breakdowns, latency, or top
          endpoints/projects/developers. The numbers above are everything that&apos;s real today: API key lifecycle
          counts from the <code className="font-mono text-xs">ApiKey</code> table, and API-related activity (key
          creates/revokes, failed requests, rate-limit triggers) from the platform activity log. Full per-request
          analytics would need a request-log table added — nothing here is a stand-in for that.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeader title="API keys" subtitle={`${formatCount(keys.total)} across every project`} />

        {keys.items.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            description="Keys created by any project, in any environment, will appear here."
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Project</TH>
                    <TH>Owner</TH>
                    <TH>Name</TH>
                    <TH>Public ID</TH>
                    <TH>Environment</TH>
                    <TH>Status</TH>
                    <TH>Last used</TH>
                    <TH>Created</TH>
                  </THead>
                  <TBody>
                    {keys.items.map((key) => (
                      <TR key={key.id}>
                        <TD>{key.project.name}</TD>
                        <TD className="text-muted">{key.owner.email}</TD>
                        <TD>{key.name ?? <Dash />}</TD>
                        <TD className="font-mono text-xs">{key.publicId}</TD>
                        <TD>
                          <Badge tone={ENVIRONMENT_TONE[key.environment]}>{key.environment}</Badge>
                        </TD>
                        <TD>
                          <Badge tone={STATUS_TONE[key.status]}>{STATUS_LABEL[key.status]}</Badge>
                        </TD>
                        <TD>{formatRelative(key.lastUsedAt)}</TD>
                        <TD>{formatDateTime(key.createdAt)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <div className="sm:hidden">
              <MobileList>
                {keys.items.map((key) => (
                  <MobileRow key={key.id}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-fg">{key.name ?? key.publicId}</span>
                      <Badge tone={STATUS_TONE[key.status]}>{STATUS_LABEL[key.status]}</Badge>
                    </div>
                    <MobileField label="Project">{key.project.name}</MobileField>
                    <MobileField label="Owner">{key.owner.email}</MobileField>
                    <MobileField label="Public ID">
                      <span className="font-mono">{key.publicId}</span>
                    </MobileField>
                    <MobileField label="Environment">
                      <Badge tone={ENVIRONMENT_TONE[key.environment]}>{key.environment}</Badge>
                    </MobileField>
                    <MobileField label="Last used">{formatRelative(key.lastUsedAt)}</MobileField>
                    <MobileField label="Created">{formatDateTime(key.createdAt)}</MobileField>
                  </MobileRow>
                ))}
              </MobileList>
            </div>

            <div className="flex items-center justify-between">
              <ButtonLink
                href={`/super-admin/api?offset=${Math.max(offset - PAGE_SIZE, 0)}`}
                variant="secondary"
                size="sm"
                aria-disabled={!hasPrevPage}
                className={!hasPrevPage ? 'pointer-events-none opacity-50' : ''}
              >
                Previous
              </ButtonLink>
              <span className="text-xs text-muted">
                {formatCount(rangeStart)}–{formatCount(rangeEnd)} of {formatCount(keys.total)}
              </span>
              <ButtonLink
                href={`/super-admin/api?offset=${offset + PAGE_SIZE}`}
                variant="secondary"
                size="sm"
                aria-disabled={!hasNextPage}
                className={!hasNextPage ? 'pointer-events-none opacity-50' : ''}
              >
                Next
              </ButtonLink>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
