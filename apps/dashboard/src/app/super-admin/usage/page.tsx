import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import {
  getUsageOverview,
  listUsageDevelopers,
  type DeveloperUsageRow,
  type UsageAlertBand,
} from '@/lib/super-admin/usage';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { ErrorState, EmptyState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount } from '@/lib/format';
import { Input } from '@/components/ui/field';
import { Button, ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Usage — Super Admin',
};

const PAGE_SIZE = 50;

const BAND_META: Record<UsageAlertBand, { label: string; tone: BadgeTone }> = {
  none: { label: 'Nominal', tone: 'neutral' },
  '50': { label: '50%+', tone: 'info' },
  '75': { label: '75%+', tone: 'warning' },
  '90': { label: '90%+', tone: 'warning' },
  '100': { label: '100%', tone: 'danger' },
};

/**
 * Platform-wide Usage & Limits (spec §14). Two data calls back the whole
 * page — an aggregate overview and a paginated per-developer list — same
 * "one page, few requests" shape as the developer-facing usage page
 * (apps/dashboard/src/app/dashboard/usage/page.tsx), reusing its Meter and
 * StatCard building blocks rather than a parallel set for the console.
 */
export default async function SuperAdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; atRisk?: string; offset?: string }>;
}) {
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/usage');

  const { search, atRisk, offset: offsetParam } = await searchParams;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10) || 0);
  const atRiskOnly = atRisk === '1';

  const [overviewResult, developersResult] = await Promise.allSettled([
    getUsageOverview(token),
    listUsageDevelopers(token, {
      search: search || undefined,
      atRisk: atRiskOnly || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
  ]);

  if (overviewResult.status === 'rejected' || developersResult.status === 'rejected') {
    const failure =
      overviewResult.status === 'rejected' ? overviewResult.reason : (developersResult as PromiseRejectedResult).reason;
    if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) redirect('/dashboard');
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Operations"
          title="Usage"
          description="Platform-wide RTC, Chat and Live Streaming allowances, per developer."
        />
        <ErrorState
          title="Could not load usage"
          description="The Super Admin API is unreachable right now. Retry in a moment."
          retryHref="/super-admin/usage"
        />
      </div>
    );
  }

  const overview = overviewResult.value;
  const { items: developers, total } = developersResult.value;
  const hasMore = offset + developers.length < total;
  const prevOffset = Math.max(0, offset - PAGE_SIZE);

  const baseQuery = (nextOffset: number) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (atRiskOnly) params.set('atRisk', '1');
    if (nextOffset > 0) params.set('offset', String(nextOffset));
    const qs = params.toString();
    return qs ? `/super-admin/usage?${qs}` : '/super-admin/usage';
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Operations"
        title="Usage"
        description="RTC minutes, chat messages and live-stream host-hours across every developer, with alerts at 50/75/90/100% of allowance."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="RTC minutes / mo" value={formatCount(overview.rtcMinutesThisMonth)} />
        <StatCard label="Chat messages / mo" value={formatCount(overview.chatMessagesThisMonth)} />
        <StatCard label="Live host-hours / mo" value={formatCount(overview.liveStreamingHostHoursThisMonth)} />
        <StatCard
          label="Developers ≥90%"
          value={formatCount(overview.developersAtRisk)}
          tone={overview.developersAtRisk > 0 ? 'warning' : 'default'}
          hint="At risk on at least one product"
        />
        <StatCard
          label="Developers at 100%"
          value={formatCount(overview.developersExhausted)}
          tone={overview.developersExhausted > 0 ? 'danger' : 'default'}
          hint="Exhausted on at least one product"
        />
      </div>

      <section className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-3" action="/super-admin/usage" method="get">
          <div className="w-full max-w-xs">
            <Input
              name="search"
              placeholder="Search by email"
              defaultValue={search ?? ''}
              aria-label="Search by email"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              name="atRisk"
              value="1"
              defaultChecked={atRiskOnly}
              className="size-4 rounded border-line"
            />
            At-risk only (≥90%)
          </label>
          <Button type="submit" variant="secondary" size="sm">
            Filter
          </Button>
        </form>

        {developers.length === 0 ? (
          <EmptyState
            title="No developers match this filter"
            description="Clear the search or the at-risk filter to see the full list."
            action={
              <ButtonLink href="/super-admin/usage" variant="secondary" size="sm">
                Clear filters
              </ButtonLink>
            }
          />
        ) : (
          <>
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <TH>Developer</TH>
                  <TH>RTC</TH>
                  <TH>Chat</TH>
                  <TH>Live Streaming</TH>
                  <TH align="right">Alert</TH>
                </THead>
                <TBody>
                  {developers.map((row) => (
                    <DeveloperTableRow key={row.userId} row={row} />
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="md:hidden">
              <MobileList>
                {developers.map((row) => (
                  <MobileRow key={row.userId} href={`/super-admin/usage/developers/${row.userId}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate font-mono text-sm text-fg">{row.email}</p>
                      <Badge tone={BAND_META[row.maxBand].tone} glyph={false}>
                        {BAND_META[row.maxBand].label}
                      </Badge>
                    </div>
                    {row.products.map((p) => (
                      <MobileField key={p.product} label={p.product}>
                        {p.provisioned ? `${formatCount(p.used)} / ${formatCount(p.included)} ${p.unit}` : 'unused'}
                      </MobileField>
                    ))}
                  </MobileRow>
                ))}
              </MobileList>
            </div>

            <nav className="flex items-center justify-between text-sm text-muted" aria-label="Pagination">
              <span>
                {formatCount(Math.min(offset + 1, total))}–{formatCount(offset + developers.length)} of{' '}
                {formatCount(total)}
              </span>
              <div className="flex gap-2">
                {offset === 0 ? (
                  <span className="inline-flex h-7 items-center rounded-sm border border-line px-2.5 text-xs font-medium text-subtle opacity-50">
                    Previous
                  </span>
                ) : (
                  <ButtonLink href={baseQuery(prevOffset)} variant="secondary" size="sm">
                    Previous
                  </ButtonLink>
                )}
                {hasMore ? (
                  <ButtonLink href={baseQuery(offset + PAGE_SIZE)} variant="secondary" size="sm">
                    Next
                  </ButtonLink>
                ) : (
                  <span className="inline-flex h-7 items-center rounded-sm border border-line px-2.5 text-xs font-medium text-subtle opacity-50">
                    Next
                  </span>
                )}
              </div>
            </nav>
          </>
        )}
      </section>
    </div>
  );
}

function DeveloperTableRow({ row }: { row: DeveloperUsageRow }) {
  return (
    <TR interactive>
      <TD>
        <a
          href={`/super-admin/usage/developers/${row.userId}`}
          className="font-mono text-xs text-accent-text hover:underline"
        >
          {row.email}
        </a>
      </TD>
      {row.products.map((p) => (
        <TD key={p.product} className="min-w-[10rem]">
          {p.provisioned ? (
            <Meter
              label={<span className="sr-only">{p.product} usage</span>}
              valueLabel={`${formatCount(p.used)} / ${formatCount(p.included)} ${p.unit}`}
              percent={p.usedPercent}
              value={p.used}
              max={Math.max(p.included, 1)}
            />
          ) : (
            <span className="text-xs text-subtle italic">unused</span>
          )}
        </TD>
      ))}
      <TD align="right">
        <Badge tone={BAND_META[row.maxBand].tone} glyph={false}>
          {BAND_META[row.maxBand].label}
        </Badge>
      </TD>
    </TR>
  );
}
