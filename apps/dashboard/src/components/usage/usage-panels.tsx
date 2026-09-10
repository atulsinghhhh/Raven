import { Badge } from '@/components/ui/badge';
import { BarChart, type Bucket } from '@/components/ui/chart';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { EmptyState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDate, formatDateTime, formatDuration } from '@/lib/format';
import type { UsageDailyBucket, UsageHistoryEntry, UsageSummary } from '@/lib/api-client';

/**
 * The shared usage panels, so the account page and the project page render
 * the same allowance the same way.
 *
 * None of these hold a copy of the numbers: every figure arrives from the
 * API in a `UsageSummary`, `includedMinutes` included. There is no `20000`
 * anywhere in this app, which is the point — an account displays the
 * allowance it was actually granted rather than whatever the current
 * default happens to be.
 */

/** The headline: how much of the allowance is gone, and what that leaves. */
export function AllowanceMeter({ summary }: { summary: UsageSummary }) {
  const tone = summary.exhausted ? 'danger' : summary.usedPercent >= 80 ? 'warning' : 'default';

  return (
    <Card>
      <CardHeader
        eyebrow="Included minutes"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {summary.exhausted ? 'Free allowance used up' : 'Free allowance'}
            {summary.exhausted && <Badge tone="danger">Exhausted</Badge>}
            {!summary.exhausted && summary.usedPercent >= 80 && <Badge tone="warning">Running low</Badge>}
          </span>
        }
        subtitle={
          summary.exhausted
            ? exhaustedSubtitle(summary)
            : 'RTC participant-minutes, metered server-side as sessions run. One participant in a room for one minute is one minute, so a three-way call spends three minutes a minute.'
        }
      />

      <Meter
        label="Minutes used"
        valueLabel={`${formatCount(summary.usedMinutes)} / ${formatCount(summary.includedMinutes)}`}
        percent={summary.usedPercent}
        value={summary.usedMinutes}
        max={summary.includedMinutes}
        hint={
          summary.exhausted
            ? undefined
            : `${formatCount(summary.remainingMinutes)} minutes remaining · ${summary.usedPercent}% used`
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-5 lg:grid-cols-4">
        <StatCard
          label="Included"
          value={formatCount(summary.includedMinutes)}
          hint={`Granted ${formatDate(summary.grantedAt)}`}
        />
        <StatCard
          label="Used"
          value={formatCount(summary.usedMinutes)}
          hint={`${formatDuration(summary.usedSeconds * 1000)} of metered session time`}
        />
        <StatCard
          label="Remaining"
          value={formatCount(summary.remainingMinutes)}
          tone={tone}
          hint={summary.exhausted ? 'No new sessions can start' : 'Minutes still available'}
        />
        <StatCard
          label="Percent used"
          value={`${summary.usedPercent}%`}
          tone={tone}
          hint={
            summary.liveSessions > 0
              ? `${formatCount(summary.liveSessions)} session(s) metering right now`
              : 'No sessions metering right now'
          }
        />
      </div>
    </Card>
  );
}

function exhaustedSubtitle(summary: UsageSummary): string {
  const when = summary.exhaustedAt ? ` on ${formatDateTime(summary.exhaustedAt)}` : '';
  return summary.enforced
    ? `All ${formatCount(summary.includedMinutes)} included minutes were used${when}. New RTC sessions are refused — sessions already running were never interrupted. The allowance does not reset.`
    : `All ${formatCount(summary.includedMinutes)} included minutes were used${when}. This deployment does not enforce the limit, so sessions still start and are still counted.`;
}

/**
 * The banner an exhausted developer needs at the top of the page, saying
 * exactly what stopped working and what did not.
 *
 * `role="alert"` rather than a quiet tint: this is the one state on the
 * page that changes what the API will do next.
 */
export function ExhaustedNotice({ summary }: { summary: UsageSummary }) {
  if (!summary.exhausted) return null;

  return (
    <div role="alert" className="rounded-lg border border-danger-line bg-danger-subtle p-5">
      <p className="text-sm font-medium text-danger-text">
        This account has used all {formatCount(summary.includedMinutes)} of its included Livqeno minutes.
      </p>
      <ul className="mt-2.5 flex flex-col gap-1.5 text-sm leading-relaxed text-danger-text/85">
        <li>
          {summary.enforced
            ? 'New RTC tokens are refused with RAVEN_USAGE_LIMIT_EXCEEDED; new room joins are refused with USAGE_LIMIT_EXCEEDED.'
            : 'Enforcement is off on this deployment, so sessions still start. Usage is still recorded.'}
        </li>
        <li>Sessions that were already running were not cut off.</li>
        <li>
          The allowance does not reset — not monthly, not on sign-in. Everything else (projects, keys, chat, webhooks,
          observability) keeps working.
        </li>
      </ul>
    </div>
  );
}

/** Consumption per UTC day. The API always returns a full window, zeroes included. */
export function DailyUsageChart({ daily, days }: { daily: UsageDailyBucket[]; days: number }) {
  const buckets: Bucket[] = daily.map((day) => ({
    label: day.date.slice(5),
    value: day.minutes,
    hint: `${day.date}: ${formatCount(day.minutes)} minute(s) across ${formatCount(day.sessions)} session(s)`,
  }));

  return (
    <Card>
      <CardHeader
        title={`Minutes per day — last ${days} days`}
        subtitle="A session counts on the UTC day it started, so a call spanning midnight lands on one side of it."
      />
      <BarChart data={buckets} caption="Metered minutes per day" emptyLabel="No metered sessions in this window" />
    </Card>
  );
}

/**
 * The session-by-session history. This *is* the ledger: the allowance
 * counter is a sum of exactly these rows.
 */
export function UsageHistoryTable({
  history,
  showProject = true,
}: {
  history: UsageHistoryEntry[];
  showProject?: boolean;
}) {
  if (history.length === 0) {
    return (
      <EmptyState
        title="No metered sessions yet"
        description="A session appears here when a participant joins a room. Minutes are counted by the signaling layer while the call runs — never reported by the client — so this list is the whole record."
      />
    );
  }

  return (
    <>
      <TableWrap className="hidden sm:block">
        <Table>
          <THead>
            {showProject && <TH>Project</TH>}
            <TH>Room</TH>
            <TH>Participant</TH>
            <TH>Environment</TH>
            <TH>Started</TH>
            <TH align="right">Metered</TH>
            <TH>Status</TH>
          </THead>
          <TBody>
            {history.map((entry) => (
              <TR key={entry.id} interactive>
                {showProject && <TD className="max-w-[16rem] truncate">{entry.projectName ?? '—'}</TD>}
                <TD className="max-w-[12rem] truncate font-mono text-xs">{entry.roomName}</TD>
                <TD className="max-w-[12rem] truncate font-mono text-xs">{entry.participantIdentity}</TD>
                <TD className="text-xs text-muted">{entry.environment.toLowerCase()}</TD>
                <TD className="text-xs whitespace-nowrap text-muted">{formatDateTime(entry.startedAt)}</TD>
                <TD align="right" className="tabular font-mono text-xs whitespace-nowrap">
                  {formatDuration(entry.meteredSeconds * 1000)}
                </TD>
                <TD>
                  <SessionStatus entry={entry} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <div className="sm:hidden">
        <MobileList>
          {history.map((entry) => (
            <MobileRow key={entry.id}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="truncate font-mono text-xs text-fg">{entry.roomName}</span>
                <SessionStatus entry={entry} />
              </div>
              {showProject && <MobileField label="Project">{entry.projectName ?? '—'}</MobileField>}
              <MobileField label="Participant">{entry.participantIdentity}</MobileField>
              <MobileField label="Started">{formatDateTime(entry.startedAt)}</MobileField>
              <MobileField label="Metered">{formatDuration(entry.meteredSeconds * 1000)}</MobileField>
            </MobileRow>
          ))}
        </MobileList>
      </div>
    </>
  );
}

/**
 * A session's outcome. `abandoned` is shown rather than smoothed into
 * "ended": it means Livqeno lost the gateway holding that session and
 * credited it only up to the last moment it was known to be alive, which
 * is exactly what a developer reconciling their minutes needs to see.
 */
function SessionStatus({ entry }: { entry: UsageHistoryEntry }) {
  if (entry.live) return <Badge tone="live">Metering</Badge>;
  if (entry.closeReason === 'abandoned') return <Badge tone="warning">Abandoned</Badge>;
  if (entry.closeReason === 'shutdown') return <Badge tone="neutral">Server restart</Badge>;
  return <Badge tone="neutral">Ended</Badge>;
}
