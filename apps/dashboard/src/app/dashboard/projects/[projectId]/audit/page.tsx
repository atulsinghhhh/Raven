import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi, type AuditLogEntry } from '@/lib/api-client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { IconSettings } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';

/**
 * The audit log: who changed what, and when.
 *
 * Read-only by construction, matching the API: there is no endpoint that
 * updates or deletes an entry, so this page offers no affordance that
 * would imply otherwise. An audit log an administrator can edit is not
 * an audit log.
 *
 * Requires `audit:read`, which only owners and admins hold. A developer
 * hitting this page gets a 403 from the API, and the empty state below
 * says so plainly, not looking like "nothing has happened".
 */

/** Every action the API can record. Mirrors AuditAction in apps/api. */
const ACTIONS = [
  'project.created',
  'project.updated',
  'project.archived',
  'api_key.created',
  'api_key.revoked',
  'member.added',
  'member.removed',
  'member.role_changed',
  'webhook.created',
  'webhook.updated',
  'webhook.deleted',
] as const;

type Action = (typeof ACTIONS)[number];

const ACTION_LABEL: Record<Action, string> = {
  'project.created': 'Project created',
  'project.updated': 'Project updated',
  'project.archived': 'Project archived',
  'api_key.created': 'Key created',
  'api_key.revoked': 'Key revoked',
  'member.added': 'Member added',
  'member.removed': 'Member removed',
  'member.role_changed': 'Role changed',
  'webhook.created': 'Webhook created',
  'webhook.updated': 'Webhook updated',
  'webhook.deleted': 'Webhook deleted',
};

/**
 * Destructive actions read as danger, additions as success, everything
 * else neutral, so a page of entries can be scanned for "what was taken
 * away" without reading every row.
 */
const ACTION_TONE: Record<Action, BadgeTone> = {
  'project.created': 'success',
  'project.updated': 'neutral',
  'project.archived': 'danger',
  'api_key.created': 'success',
  'api_key.revoked': 'danger',
  'member.added': 'success',
  'member.removed': 'danger',
  'member.role_changed': 'warning',
  'webhook.created': 'success',
  'webhook.updated': 'neutral',
  'webhook.deleted': 'danger',
};

const FETCH_LIMIT = 200;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;

  // An unrecognised action falls back to "no filter" rather than asking
  // the API for something it will reject.
  const action = (ACTIONS as readonly string[]).includes(sp.action ?? '') ? (sp.action as Action) : undefined;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  // Counts come from an unfiltered fetch so the chips keep their meaning
  // while a filter is applied: same reasoning as the errors page.
  const [allResult, filteredResult] = await Promise.allSettled([
    ravenApi.listAuditLogs(token, projectId, { limit: FETCH_LIMIT }),
    action
      ? ravenApi.listAuditLogs(token, projectId, { action, limit: FETCH_LIMIT })
      : Promise.resolve<AuditLogEntry[] | null>(null),
  ]);

  if (allResult.status === 'rejected') {
    const reason = allResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');

    if (reason instanceof ApiError && reason.status === 403) {
      return (
        <div className="flex flex-col gap-8">
          <PageHeader title="Audit log" description="Administrative actions taken on this project." />
          <EmptyState
            title="You don't have access to the audit log"
            description="Reading it requires the audit:read capability, which owners and admins hold. Ask an owner to change your role if you need it."
            icon={<IconSettings className="size-6" />}
            action={
              <ButtonLink href={`${base}/settings`} variant="secondary">
                View project settings
              </ButtonLink>
            }
          />
        </div>
      );
    }

    if (reason instanceof ApiError && reason.status === 404) {
      return (
        <EmptyState
          title="Project not found"
          description="This project no longer exists, or it belongs to a different account."
          action={
            <ButtonLink href="/dashboard/projects" variant="primary">
              Back to projects
            </ButtonLink>
          }
        />
      );
    }

    return (
      <ErrorState
        title="Could not load the audit log"
        description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
        retryHref={`${base}/audit`}
      />
    );
  }

  const now = renderClock();
  const all = allResult.value;
  const counts = countActions(all);

  const rows =
    action != null
      ? filteredResult.status === 'fulfilled' && filteredResult.value
        ? filteredResult.value
        : null
      : all;

  const actors = new Set(all.map((entry) => entry.actorEmail)).size;
  const newest = all[0]?.createdAt ?? null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Audit log"
        description={`Who changed what, and when. Read-only — entries cannot be edited or deleted by anyone, including you. Raven keeps the ${formatCount(FETCH_LIMIT)} most recent records available here.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Recorded actions" value={formatCount(all.length)} hint={`Most recent ${FETCH_LIMIT}`} />
        <StatCard label="People involved" value={formatCount(actors)} hint="Distinct actors" />
        <StatCard
          label="Most recent"
          value={newest ? formatRelative(newest, now) : <NoDataYet label="Never" />}
          hint={newest ? formatDateTime(newest) : undefined}
        />
      </div>

      <section>
        <SectionHeader
          title="Filter by action"
          subtitle="Queried server-side. Counts are across the most recent records, so they stay meaningful while a filter is on."
          action={
            action ? (
              <a href={`${base}/audit`} className="text-xs font-medium text-accent-text hover:underline">
                Clear filter
              </a>
            ) : undefined
          }
        />
        <Card>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip href={`${base}/audit`} active={action === undefined} label="All actions" count={all.length}>
              All actions
            </FilterChip>
            {ACTIONS.filter((a) => (counts[a] ?? 0) > 0).map((a) => (
              <FilterChip
                key={a}
                href={`${base}/audit?action=${encodeURIComponent(a)}`}
                active={action === a}
                label={ACTION_LABEL[a]}
                count={counts[a] ?? 0}
              >
                {ACTION_LABEL[a]}
              </FilterChip>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader
          title={action ? ACTION_LABEL[action] : 'All activity'}
          subtitle={rows === null ? undefined : `${formatCount(rows.length)} shown, newest first.`}
        />

        {rows === null ? (
          <ErrorState
            title="Could not load the filtered entries"
            description="The action query failed, but the summary above is still accurate."
            retryHref={`${base}/audit?action=${action ?? ''}`}
          />
        ) : rows.length === 0 ? (
          action ? (
            <EmptyState
              title="Nothing matches this filter"
              description={`No ${ACTION_LABEL[action].toLowerCase()} entries are among the most recent records.`}
              icon={<IconSettings className="size-6" />}
              action={
                <ButtonLink href={`${base}/audit`} variant="primary">
                  Clear filter
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              title="No administrative activity yet"
              description="Creating an API key, adding a member, or changing a webhook all appear here automatically. Nothing has happened on this project yet that would be worth recording."
              icon={<IconSettings className="size-6" />}
              action={
                <ButtonLink href={`${base}/api-keys`} variant="secondary">
                  Manage API keys
                </ButtonLink>
              }
            />
          )
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>Action</TH>
                  <TH>Actor</TH>
                  <TH>Resource</TH>
                  <TH>Environment</TH>
                  <TH align="right">When</TH>
                </THead>
                <TBody>
                  {rows.map((entry) => (
                    <TR key={entry.publicId}>
                      <TD>
                        <ActionBadge action={entry.action} />
                      </TD>
                      <TD>
                        <span className="text-sm text-fg">{entry.actorEmail}</span>
                      </TD>
                      <TD>
                        {entry.resourceId ? (
                          <span className="font-mono text-xs text-muted">{entry.resourceId}</span>
                        ) : (
                          <span className="text-xs text-subtle">{entry.resourceType}</span>
                        )}
                      </TD>
                      <TD>
                        {entry.environment ? (
                          <Badge tone={entry.environment === 'PRODUCTION' ? 'warning' : 'neutral'} glyph={false}>
                            {entry.environment.toLowerCase()}
                          </Badge>
                        ) : (
                          <Dash />
                        )}
                      </TD>
                      <TD align="right">
                        <time
                          dateTime={entry.createdAt}
                          title={`${formatDateTime(entry.createdAt)}${entry.requestId ? ` — ${entry.requestId}` : ''}`}
                          className="tabular text-xs whitespace-nowrap text-subtle"
                        >
                          {formatRelative(entry.createdAt, now)}
                        </time>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="sm:hidden">
              <MobileList>
                {rows.map((entry) => (
                  <MobileRow key={entry.publicId}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <ActionBadge action={entry.action} />
                      <time
                        dateTime={entry.createdAt}
                        title={formatDateTime(entry.createdAt)}
                        className="tabular shrink-0 text-xs text-subtle"
                      >
                        {formatRelative(entry.createdAt, now)}
                      </time>
                    </div>
                    <MobileField label="Actor">
                      <span className="text-xs">{entry.actorEmail}</span>
                    </MobileField>
                    <MobileField label="Resource">
                      {entry.resourceId ? (
                        <span className="font-mono text-xs">{entry.resourceId}</span>
                      ) : (
                        <span className="text-xs">{entry.resourceType}</span>
                      )}
                    </MobileField>
                    {entry.requestId && (
                      <MobileField label="Request">
                        <span className="font-mono text-xs">{entry.requestId}</span>
                      </MobileField>
                    )}
                  </MobileRow>
                ))}
              </MobileList>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * One clock read per request. This is an async Server Component: it
 * renders exactly once per navigation, so a single timestamp shared by
 * every relative time keeps them consistent with each other instead of
 * drifting mid-render. Same reasoning as the errors page.
 */
function renderClock(): number {
  return Date.now();
}

function countActions(entries: AuditLogEntry[]): Partial<Record<Action, number>> {
  const counts: Partial<Record<Action, number>> = {};
  for (const entry of entries) {
    if ((ACTIONS as readonly string[]).includes(entry.action)) {
      const action = entry.action as Action;
      counts[action] = (counts[action] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * An action the console doesn't recognise still renders: a newer API
 * recording something this build predates should show up as itself, not
 * vanish from the list.
 */
function ActionBadge({ action }: { action: string }) {
  const known = (ACTIONS as readonly string[]).includes(action);
  if (!known) {
    return (
      <Badge tone="neutral" glyph={false}>
        {action}
      </Badge>
    );
  }
  const typed = action as Action;
  return <Badge tone={ACTION_TONE[typed]}>{ACTION_LABEL[typed]}</Badge>;
}

function FilterChip({
  href,
  active,
  label,
  count,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={count === undefined ? label : `${label} — ${formatCount(count)}`}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-accent-line bg-accent-subtle text-accent-text'
          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
      }`}
    >
      {children}
      {count !== undefined && (
        <span className={`tabular ${active ? 'text-accent-text' : count === 0 ? 'text-subtle' : 'text-fg'}`}>
          {formatCount(count)}
        </span>
      )}
    </a>
  );
}
