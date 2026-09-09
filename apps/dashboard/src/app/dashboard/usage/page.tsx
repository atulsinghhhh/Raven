import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { AccountShell } from '@/components/shell/account-shell';
import { deriveSystemStatus } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, SectionHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/states';
import { Meter } from '@/components/ui/meter';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { AllowanceMeter, DailyUsageChart, ExhaustedNotice, UsageHistoryTable } from '@/components/usage/usage-panels';
import { formatCount, formatDuration } from '@/lib/format';
import { DOCS_URL } from '@/lib/nav';

export const metadata: Metadata = {
  title: 'Usage — Raven',
};

/**
 * The developer's Raven-minute allowance.
 *
 * Account-level, not project-level, because the allowance is: every
 * project a developer owns spends the same minutes. The per-project page
 * (`/dashboard/projects/[id]/usage`) shows one project's share of this
 * same meter.
 *
 * One request backs the whole page. `/v1/usage/detail` returns the
 * summary, the session history, the daily rollup and the per-project
 * breakdown together — they are all derived from the same two tables, so
 * splitting them across requests would only buy a chance of showing
 * figures that disagree with each other.
 */

/** Session rows to list. The API caps this at 200. */
const HISTORY_LIMIT = 100;
/** Days in the daily chart. */
const CHART_DAYS = 30;

export default async function AccountUsagePage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');
  const email = decodeSessionEmail(token);

  const [usageResult, healthResult] = await Promise.allSettled([
    ravenApi.getUsageDetail(token, { limit: HISTORY_LIMIT, days: CHART_DAYS }),
    ravenApi.getHealth(),
  ]);
  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';

  if (usageResult.status === 'rejected') {
    if (usageResult.reason instanceof ApiError && usageResult.reason.status === 401) redirect('/login');
    return (
      <AccountShell email={email} systemStatus={systemStatus}>
        <ErrorState
          title="Could not load usage"
          description="The Control API is unreachable right now. Your minutes are unaffected — this page could not read them."
          retryHref="/dashboard/usage"
        />
      </AccountShell>
    );
  }

  const { summary, history, daily, byProject } = usageResult.value;

  return (
    <AccountShell email={email} systemStatus={systemStatus}>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Account"
          title="Usage"
          description="Raven minutes included with this account, what has been used, and the sessions that used them. Metered server-side by the signaling layer — a client cannot report, reduce, or suppress its own usage."
          actions={
            <ButtonLink href={`${DOCS_URL}/concepts/usage`} variant="secondary" size="sm">
              How metering works
            </ButtonLink>
          }
        />

        <ExhaustedNotice summary={summary} />

        <AllowanceMeter summary={summary} />

        <DailyUsageChart daily={daily} days={CHART_DAYS} />

        <section>
          <SectionHeader
            title="By project"
            subtitle="Which projects spent the minutes. Every project you own draws down this one allowance."
          />
          {byProject.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">
                No project has metered a session yet. Minutes start counting when a participant joins a room.
              </p>
            </Card>
          ) : (
            <>
              <TableWrap className="hidden sm:block">
                <Table>
                  <THead>
                    <TH>Project</TH>
                    <TH align="right">Sessions</TH>
                    <TH align="right">Minutes</TH>
                    <TH align="right">Session time</TH>
                    <TH className="w-[28%]">Share of used minutes</TH>
                  </THead>
                  <TBody>
                    {byProject.map((row) => (
                      <TR key={row.projectId} interactive>
                        <TD className="max-w-[18rem] truncate">
                          <a
                            href={`/dashboard/projects/${row.projectId}/usage`}
                            className="text-accent-text hover:underline"
                          >
                            {row.projectName ?? row.projectId}
                          </a>
                        </TD>
                        <TD align="right" className="tabular font-mono text-xs">
                          {formatCount(row.sessions)}
                        </TD>
                        <TD align="right" className="tabular font-mono text-xs">
                          {formatCount(row.minutes)}
                        </TD>
                        <TD align="right" className="tabular font-mono text-xs whitespace-nowrap">
                          {formatDuration(row.seconds * 1000)}
                        </TD>
                        <TD>
                          {/* Share of what has been *used*, not of the
                              allowance: at 1% spent, every project would
                              otherwise render as an empty bar. */}
                          <Meter
                            label={<span className="sr-only">Share of used minutes</span>}
                            valueLabel={`${percentOf(row.seconds, summary.usedSeconds)}%`}
                            percent={Number(percentOf(row.seconds, summary.usedSeconds))}
                            value={row.seconds}
                            max={Math.max(summary.usedSeconds, 1)}
                            tone="default"
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <div className="sm:hidden">
                <MobileList>
                  {byProject.map((row) => (
                    <MobileRow key={row.projectId} href={`/dashboard/projects/${row.projectId}/usage`}>
                      <p className="mb-2 truncate text-sm font-medium text-fg">{row.projectName ?? row.projectId}</p>
                      <MobileField label="Minutes">{formatCount(row.minutes)}</MobileField>
                      <MobileField label="Sessions">{formatCount(row.sessions)}</MobileField>
                      <MobileField label="Session time">{formatDuration(row.seconds * 1000)}</MobileField>
                    </MobileRow>
                  ))}
                </MobileList>
              </div>
            </>
          )}
        </section>

        <section>
          <SectionHeader
            title="Session history"
            subtitle={`The ${HISTORY_LIMIT} most recent metered sessions. The used-minutes figure above is the sum of every session on record, not just these.`}
          />
          <UsageHistoryTable history={history} />
        </section>

        <Card>
          <CardHeader
            title="What is and isn't metered"
            subtitle="Stated plainly, because a figure that quietly excludes something is worse than no figure."
          />
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm leading-relaxed sm:grid-cols-2">
            <MeteringNote title="RTC participant-minutes" metered>
              One participant in one room for one minute. A three-way call spends three minutes a minute.
            </MeteringNote>
            <MeteringNote title="Chat, Live Streaming, Effects">
              Not metered. Live Streaming&apos;s hosts and viewers are RTC participants, so their <em>media</em> time is
              counted above.
            </MeteringNote>
            <MeteringNote title="TURN relay bandwidth">
              Not metered. Bytes relayed are not counted or attributed.
            </MeteringNote>
            <MeteringNote title="Storage, API requests, webhooks">Not metered.</MeteringNote>
          </dl>
          <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-subtle">
            There is no billing, no plan and no payment path behind this page — the allowance is a fixed grant that does
            not reset. Nothing here can be adjusted from the dashboard.
          </p>
        </Card>
      </div>
    </AccountShell>
  );
}

function MeteringNote({
  title,
  metered = false,
  children,
}: {
  title: string;
  metered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span
        aria-hidden="true"
        className={`mt-2 size-1.5 shrink-0 rounded-full ${metered ? 'bg-accent' : 'bg-subtle'}`}
      />
      <div className="min-w-0">
        <dt className="inline font-medium text-fg">{title}.</dt> <dd className="inline text-muted">{children}</dd>
      </div>
    </div>
  );
}

/** One decimal, and `0` rather than `NaN` when nothing has been used yet. */
function percentOf(part: number, whole: number): string {
  if (whole <= 0) return '0';
  return (Math.round((part / whole) * 1000) / 10).toString();
}
