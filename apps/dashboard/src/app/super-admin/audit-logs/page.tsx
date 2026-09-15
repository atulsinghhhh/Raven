import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import {
  ADMIN_ACTIONS,
  listAdminAuditLogs,
  type AdminAction,
  type AdminAuditLog,
  type AdminAuditLogFilters,
} from '@/lib/super-admin/audit-logs';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { IconAudit } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';

/**
 * §9 — the immutable log of what Raven *administrators* did, distinct from
 * the Global Activity Explorer (`/super-admin/activity`), which covers
 * developer/business events instead.
 *
 * Read-only by construction, matching the API: `AdminAuditService` exposes
 * no update or delete method at all, so this page offers no affordance
 * that would imply otherwise. An audit log an administrator can edit is
 * not an audit log.
 */

const ACTION_LABEL: Record<AdminAction, string> = {
  'admin.login': 'Admin login',
  'admin.user_viewed': 'User viewed',
  'admin.project_viewed': 'Project viewed',
  'admin.account_suspended': 'Account suspended',
  'admin.account_unsuspended': 'Account unsuspended',
  'admin.limit_changed': 'Limit changed',
  'admin.platform_role_granted': 'Platform role granted',
  'admin.platform_role_revoked': 'Platform role revoked',
  'admin.api_key_revoked': 'API key revoked',
  'admin.project_state_changed': 'Project state changed',
};

/**
 * Destructive actions (suspend, revoke, role revoke) read as danger,
 * grants/restorations as success, plain views as neutral, and the two
 * "changed" actions as warning since they're mutations without a clean
 * good/bad direction. Login is its own thing — an auth event, not a
 * mutation of anything — so it gets `info` rather than `neutral`.
 */
const ACTION_TONE: Record<AdminAction, BadgeTone> = {
  'admin.login': 'info',
  'admin.user_viewed': 'neutral',
  'admin.project_viewed': 'neutral',
  'admin.account_suspended': 'danger',
  'admin.account_unsuspended': 'success',
  'admin.limit_changed': 'warning',
  'admin.platform_role_granted': 'success',
  'admin.platform_role_revoked': 'danger',
  'admin.api_key_revoked': 'danger',
  'admin.project_state_changed': 'warning',
};

const FETCH_LIMIT = 200;
const BASE = '/super-admin/audit-logs';

interface SearchParams {
  action?: string;
  adminId?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
}

export default async function SuperAdminAuditLogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  // An unrecognised action falls back to "no filter" rather than asking
  // the API for something it will reject.
  const action = (ADMIN_ACTIONS as readonly string[]).includes(sp.action ?? '')
    ? (sp.action as AdminAction)
    : undefined;
  const adminId = sp.adminId || undefined;
  const targetType = sp.targetType || undefined;
  const targetId = sp.targetId || undefined;
  const from = sp.from || undefined;
  const to = sp.to || undefined;

  const hasNarrowingFilter = Boolean(action || adminId || targetType || targetId || from || to);

  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/audit-logs');

  // The unfiltered fetch is the basis for the action chips' counts and the
  // "distinct admins" / "most recent" stats, so those keep their platform-
  // wide meaning while a filter narrows the table below — same reasoning
  // as the project-scoped audit page.
  const filters: AdminAuditLogFilters = { action, adminId, targetType, targetId, from, to, limit: FETCH_LIMIT };
  const [allResult, filteredResult] = await Promise.allSettled([
    listAdminAuditLogs(token, { limit: FETCH_LIMIT }),
    hasNarrowingFilter ? listAdminAuditLogs(token, filters) : Promise.resolve(null),
  ]);

  if (allResult.status === 'rejected') {
    const reason = allResult.reason;
    if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
      redirect('/dashboard');
    }
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Audit Logs"
          description="Every action a Raven administrator has taken on the platform. Immutable — nothing here can be edited or deleted, by anyone, including a Super Admin."
        />
        <ErrorState
          title="Could not load the audit log"
          description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
          retryHref={BASE}
        />
      </div>
    );
  }

  const now = renderClock();
  const all = allResult.value.items;
  const counts = countActions(all);

  const rows = hasNarrowingFilter
    ? filteredResult.status === 'fulfilled' && filteredResult.value
      ? filteredResult.value.items
      : null
    : all;

  const admins = new Set(all.map((entry) => entry.adminEmail)).size;
  const newest = all[0]?.createdAt ?? null;

  const clearHref = (omit: 'action' | 'adminId' | 'targetType' | 'targetId' | 'range') => {
    const params = new URLSearchParams();
    if (omit !== 'action' && action) params.set('action', action);
    if (omit !== 'adminId' && adminId) params.set('adminId', adminId);
    if (omit !== 'targetType' && targetType) params.set('targetType', targetType);
    if (omit !== 'targetId' && targetId) params.set('targetId', targetId);
    if (omit !== 'range' && from) params.set('from', from);
    if (omit !== 'range' && to) params.set('to', to);
    const q = params.toString();
    return q ? `${BASE}?${q}` : BASE;
  };

  const withAction = (a?: AdminAction) => {
    const params = new URLSearchParams();
    if (a) params.set('action', a);
    if (adminId) params.set('adminId', adminId);
    if (targetType) params.set('targetType', targetType);
    if (targetId) params.set('targetId', targetId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const q = params.toString();
    return q ? `${BASE}?${q}` : BASE;
  };

  const withAdmin = (id: string) => {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    params.set('adminId', id);
    const q = params.toString();
    return `${BASE}?${q}`;
  };

  const withTarget = (type: string, id: string | null) => {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    params.set('targetType', type);
    if (id) params.set('targetId', id);
    const q = params.toString();
    return `${BASE}?${q}`;
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Audit Logs"
        description={`Every action a Raven administrator has taken on the platform, newest first. Immutable — there is no endpoint that updates or removes an entry, so nobody, including a Super Admin, can edit this record. The ${formatCount(FETCH_LIMIT)} most recent entries are available here.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Entries shown"
          value={formatCount(rows?.length ?? 0)}
          hint={hasNarrowingFilter ? 'Matching current filters' : `Most recent ${FETCH_LIMIT}`}
        />
        <StatCard label="Distinct admins" value={formatCount(admins)} hint="Across the most recent entries" />
        <StatCard
          label="Most recent"
          value={newest ? formatRelative(newest, now) : <NoDataYet label="Never" />}
          hint={newest ? formatDateTime(newest) : undefined}
        />
      </div>

      <section>
        <SectionHeader
          title="Filter by action"
          subtitle="Queried server-side. Counts are across the most recent entries, so they stay meaningful while a filter is on."
          action={
            hasNarrowingFilter ? (
              <a href={BASE} className="text-xs font-medium text-accent-text hover:underline">
                Clear all filters
              </a>
            ) : undefined
          }
        />
        <Card>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              href={withAction(undefined)}
              active={action === undefined}
              label="All actions"
              count={all.length}
            >
              All actions
            </FilterChip>
            {ADMIN_ACTIONS.filter((a) => (counts[a] ?? 0) > 0).map((a) => (
              <FilterChip
                key={a}
                href={withAction(a)}
                active={action === a}
                label={ACTION_LABEL[a]}
                count={counts[a] ?? 0}
              >
                {ACTION_LABEL[a]}
              </FilterChip>
            ))}
          </div>

          {(adminId || targetType || targetId || from || to) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
              <span className="mono-label text-[11px] text-muted">Also narrowed by</span>
              {adminId && <RemovableChip href={clearHref('adminId')}>admin: {adminId}</RemovableChip>}
              {targetType && (
                <RemovableChip href={clearHref('targetType')}>
                  target type: {targetType}
                  {targetId ? '' : ''}
                </RemovableChip>
              )}
              {targetId && <RemovableChip href={clearHref('targetId')}>target id: {targetId}</RemovableChip>}
              {(from || to) && (
                <RemovableChip href={clearHref('range')}>
                  {from ? formatDateTime(from) : 'the start'} — {to ? formatDateTime(to) : 'now'}
                </RemovableChip>
              )}
            </div>
          )}
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Narrow by date range"
          subtitle="Applies on top of any action, admin, or target filter already active."
        />
        <Card>
          <form method="GET" action={BASE} className="flex flex-wrap items-end gap-3">
            {action && <input type="hidden" name="action" value={action} />}
            {adminId && <input type="hidden" name="adminId" value={adminId} />}
            {targetType && <input type="hidden" name="targetType" value={targetType} />}
            {targetId && <input type="hidden" name="targetId" value={targetId} />}
            <label className="flex flex-col gap-1 text-xs text-muted">
              From
              <input
                type="datetime-local"
                name="from"
                defaultValue={from ? toLocalInputValue(from) : undefined}
                className="rounded-sm border border-line bg-surface px-2 py-1 text-sm text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              To
              <input
                type="datetime-local"
                name="to"
                defaultValue={to ? toLocalInputValue(to) : undefined}
                className="rounded-sm border border-line bg-surface px-2 py-1 text-sm text-fg"
              />
            </label>
            <button
              type="submit"
              className="rounded-sm border border-line-strong bg-surface-raised px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-sunken"
            >
              Apply
            </button>
            {(from || to) && (
              <a href={clearHref('range')} className="text-xs font-medium text-accent-text hover:underline">
                Clear date range
              </a>
            )}
          </form>
        </Card>
      </section>

      <section>
        <SectionHeader
          title={hasNarrowingFilter ? 'Filtered activity' : 'All activity'}
          subtitle={rows === null ? undefined : `${formatCount(rows.length)} shown, newest first.`}
        />

        {rows === null ? (
          <ErrorState
            title="Could not load the filtered entries"
            description="The filtered query failed, but the summary above is still accurate."
            retryHref={withAction(action)}
          />
        ) : rows.length === 0 ? (
          hasNarrowingFilter ? (
            <EmptyState
              title="Nothing matches these filters"
              description="No entries among the most recent records match the current combination of filters."
              icon={<IconAudit className="size-6" />}
              action={
                <ButtonLink href={BASE} variant="primary">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              title="No administrative activity yet"
              description="Suspending an account, changing a limit, or granting a platform role all appear here automatically. Nothing has happened on the platform yet that would be worth recording."
              icon={<IconAudit className="size-6" />}
            />
          )
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>Admin</TH>
                  <TH>Action</TH>
                  <TH>Target</TH>
                  <TH>Reason</TH>
                  <TH>Details</TH>
                  <TH align="right">When</TH>
                </THead>
                <TBody>
                  {rows.map((entry) => (
                    <TR key={entry.publicId}>
                      <TD>
                        <a href={withAdmin(entry.adminId)} className="text-sm text-fg hover:underline">
                          {entry.adminEmail}
                        </a>
                      </TD>
                      <TD>
                        <ActionBadge action={entry.action} />
                      </TD>
                      <TD>
                        {entry.targetId || entry.targetType ? (
                          <a href={withTarget(entry.targetType, entry.targetId)} className="hover:underline">
                            <span className="text-xs text-subtle">{entry.targetType}</span>
                            {entry.targetId && (
                              <>
                                {' '}
                                <span className="font-mono text-xs text-muted">{entry.targetId}</span>
                              </>
                            )}
                          </a>
                        ) : (
                          <Dash />
                        )}
                      </TD>
                      <TD>{entry.reason ? <span className="text-sm text-fg">{entry.reason}</span> : <Dash />}</TD>
                      <TD>
                        <EntryDetails entry={entry} />
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
                    <MobileField label="Admin">
                      <span className="text-xs">{entry.adminEmail}</span>
                    </MobileField>
                    <MobileField label="Target">
                      {entry.targetId || entry.targetType ? (
                        <span className="font-mono text-xs">{entry.targetId ?? entry.targetType}</span>
                      ) : (
                        <Dash />
                      )}
                    </MobileField>
                    {entry.reason && (
                      <MobileField label="Reason">
                        <span className="text-xs">{entry.reason}</span>
                      </MobileField>
                    )}
                    {entry.requestId && (
                      <MobileField label="Request">
                        <span className="font-mono text-xs">{entry.requestId}</span>
                      </MobileField>
                    )}
                    <div className="mt-2">
                      <EntryDetails entry={entry} />
                    </div>
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
 * drifting mid-render. Same reasoning as the project-scoped audit page.
 */
function renderClock(): number {
  return Date.now();
}

function countActions(entries: AdminAuditLog[]): Partial<Record<AdminAction, number>> {
  const counts: Partial<Record<AdminAction, number>> = {};
  for (const entry of entries) {
    if ((ADMIN_ACTIONS as readonly string[]).includes(entry.action)) {
      const action = entry.action as AdminAction;
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
  const known = (ADMIN_ACTIONS as readonly string[]).includes(action);
  if (!known) {
    return (
      <Badge tone="neutral" glyph={false}>
        {action}
      </Badge>
    );
  }
  const typed = action as AdminAction;
  return <Badge tone={ACTION_TONE[typed]}>{ACTION_LABEL[typed]}</Badge>;
}

/**
 * Everything that doesn't fit in a table cell without either truncating
 * or dwarfing every other row: IP, user agent, request id, and the
 * before/after JSON snapshots. Always rendered as escaped text inside
 * `<pre>` — never `dangerouslySetInnerHTML` — since these fields are
 * admin-authored free text and JSON, not markup Raven controls.
 */
function EntryDetails({ entry }: { entry: AdminAuditLog }) {
  const hasContext = entry.ipAddress || entry.userAgent || entry.requestId || entry.metadata;
  const hasState = entry.beforeState || entry.afterState;

  if (!hasContext && !hasState) {
    return <Dash />;
  }

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs font-medium text-accent-text hover:underline">View</summary>
      <div className="mt-2 flex max-w-md flex-col gap-2 rounded-sm border border-line bg-surface-sunken p-2.5 text-xs">
        {entry.requestId && (
          <div>
            <span className="text-muted">Request ID: </span>
            <span className="font-mono">{entry.requestId}</span>
          </div>
        )}
        {entry.ipAddress && (
          <div>
            <span className="text-muted">IP: </span>
            <span className="font-mono">{entry.ipAddress}</span>
          </div>
        )}
        {entry.userAgent && (
          <div className="break-all">
            <span className="text-muted">User agent: </span>
            <span className="font-mono">{entry.userAgent}</span>
          </div>
        )}
        {hasState && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="mono-label mb-1 text-[10px] text-muted">Before</div>
              {entry.beforeState ? (
                <pre className="max-h-48 overflow-auto rounded-sm border border-line bg-surface p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">
                  {JSON.stringify(entry.beforeState, null, 2)}
                </pre>
              ) : (
                <Dash />
              )}
            </div>
            <div>
              <div className="mono-label mb-1 text-[10px] text-muted">After</div>
              {entry.afterState ? (
                <pre className="max-h-48 overflow-auto rounded-sm border border-line bg-surface p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">
                  {JSON.stringify(entry.afterState, null, 2)}
                </pre>
              ) : (
                <Dash />
              )}
            </div>
          </div>
        )}
        {entry.metadata && (
          <div>
            <div className="mono-label mb-1 text-[10px] text-muted">Metadata</div>
            <pre className="max-h-48 overflow-auto rounded-sm border border-line bg-surface p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
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

function RemovableChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:border-line-strong hover:text-fg"
    >
      {children}
      <span aria-hidden="true">×</span>
    </a>
  );
}

/** `datetime-local` inputs want `YYYY-MM-DDTHH:mm`, not a full ISO string. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
