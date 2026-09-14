import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, superAdminApi } from '@/lib/super-admin-client';
import {
  getDeveloper,
  type ActivityEventSummary,
  type DeveloperDetail,
  type DeveloperProjectRow,
} from '@/lib/super-admin/developers';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { IconMembers, IconShield } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatClockTime, formatCount, formatDateTime, formatRelative } from '@/lib/format';

const TABS = ['overview', 'projects', 'activity', 'usage', 'security'] as const;
type Tab = (typeof TABS)[number];

/** One clock read per request — see the same helper on the directory page for why. */
function renderClock(): number {
  return Date.now();
}

export default async function DeveloperDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'overview';

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/super-admin/developers/${id}`;

  const [detailResult, meResult] = await Promise.allSettled([getDeveloper(token, id), superAdminApi.me(token)]);

  if (detailResult.status === 'rejected') {
    const reason = detailResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    if (reason instanceof ApiError && reason.status === 404) {
      return (
        <EmptyState
          title="Developer not found"
          description="This account no longer exists, or the id is wrong."
          icon={<IconMembers className="size-6" />}
          action={
            <ButtonLink href="/super-admin/developers" variant="primary">
              Back to developers
            </ButtonLink>
          }
        />
      );
    }
    if (reason instanceof ApiError && reason.status === 403) {
      return (
        <EmptyState
          title="Your platform role does not permit this"
          description="Viewing developer detail requires Super Admin Portal access."
          icon={<IconShield className="size-6" />}
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this developer"
        description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
        retryHref={base}
      />
    );
  }

  const developer = detailResult.value;
  const canMutate = meResult.status === 'fulfilled' && (meResult.value.platformRole === 'SUPER_ADMIN' || meResult.value.platformRole === 'ADMIN');
  const now = renderClock();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        breadcrumb={{ label: 'Developers', href: '/super-admin/developers' }}
        eyebrow="Developer"
        title={developer.name ?? developer.email}
        description={developer.email}
        meta={<StatusBadge status={developer.status} />}
        actions={<SuspendUnsuspendForm id={id} status={developer.status} canMutate={canMutate} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="User ID" value={<span className="font-mono text-sm">{developer.id.slice(0, 8)}…</span>} hint={developer.id} />
        <StatCard label="Created" value={formatDateTime(developer.createdAt)} />
        <StatCard label="Last active" value={developer.lastActiveAt ? formatRelative(developer.lastActiveAt, now) : <NoDataYet label="Never" />} />
        <StatCard label="Auth" value={developer.authProviders.length > 0 ? developer.authProviders.map(providerLabel).join(', ') : <Dash />} />
        <StatCard label="Risk" value={<RiskBadge level={developer.riskLevel} />} />
      </div>

      {sp.error && (
        <div role="alert" className="rounded-lg border border-danger-line bg-danger-subtle p-4">
          <p className="text-sm font-medium text-danger-text">{describeMutationError(sp.error)}</p>
        </div>
      )}

      {developer.status === 'SUSPENDED' && developer.suspendedReason && (
        <div role="alert" className="rounded-lg border border-danger-line bg-danger-subtle p-4">
          <p className="text-sm font-medium text-danger-text">Account suspended</p>
          <p className="mt-1 text-sm text-danger-text/85">
            {developer.suspendedReason}
            {developer.suspendedAt && ` — ${formatDateTime(developer.suspendedAt)}`}
          </p>
        </div>
      )}

      <TabBar base={base} active={tab} />

      {tab === 'overview' && <OverviewTab developer={developer} now={now} />}
      {tab === 'projects' && <ProjectsTab projects={developer.projects} />}
      {tab === 'activity' && <ActivityTab events={developer.activity} />}
      {tab === 'usage' && <UsageTab developer={developer} />}
      {tab === 'security' && <SecurityTab events={developer.security} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: DeveloperDetail['status'] }) {
  return status === 'ACTIVE' ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>;
}

const RISK_TONE: Record<DeveloperDetail['riskLevel'], BadgeTone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' };

function RiskBadge({ level }: { level: DeveloperDetail['riskLevel'] }) {
  return <Badge tone={RISK_TONE[level]}>{level === 'LOW' ? 'Low' : level === 'MEDIUM' ? 'Medium' : level === 'HIGH' ? 'High' : 'Critical'}</Badge>;
}

/** Surfaced by the suspend/unsuspend route handlers via a `?error=` redirect param — the API's HTTP status, or `reason_required` for a client-side check. */
function describeMutationError(code: string): string {
  if (code === 'reason_required') return 'A reason is required to suspend or unsuspend an account.';
  if (code === '409') return 'This account’s status already changed — reload to see the current state.';
  if (code === '403') return 'Your platform role does not permit this action.';
  return 'Could not update this account. Nothing was lost — try again.';
}

function providerLabel(p: string): string {
  if (p === 'EMAIL_PASSWORD') return 'Email/password';
  if (p === 'GITHUB') return 'GitHub';
  if (p === 'GOOGLE') return 'Google';
  return p;
}

/**
 * Plain HTML forms posting to Next.js Route Handlers
 * (`app/api/super-admin/developers/[id]/{suspend,unsuspend}/route.ts`) —
 * no client JS required, works with the browser's own POST-then-redirect.
 * Hidden entirely for a `SUPPORT`/`READ_ONLY` admin: the API would 403 the
 * request anyway (`PlatformRoleGuard` re-checks server-side regardless of
 * what this page renders), so this is UX only, not the security boundary.
 */
function SuspendUnsuspendForm({ id, status, canMutate }: { id: string; status: DeveloperDetail['status']; canMutate: boolean }) {
  if (!canMutate) return null;

  if (status === 'ACTIVE') {
    return (
      <form action={`/api/super-admin/developers/${id}/suspend`} method="POST" className="flex items-center gap-2">
        <input
          type="text"
          name="reason"
          required
          placeholder="Reason for suspension"
          className="h-9 w-56 rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:border-line-strong focus:outline-none"
        />
        <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-danger px-3.5 text-sm font-semibold text-white transition-colors hover:opacity-90">
          Suspend account
        </button>
      </form>
    );
  }

  return (
    <form action={`/api/super-admin/developers/${id}/unsuspend`} method="POST" className="flex items-center gap-2">
      <input
        type="text"
        name="reason"
        required
        placeholder="Reason for unsuspending"
        className="h-9 w-56 rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:border-line-strong focus:outline-none"
      />
      <button type="submit" className="glow-accent inline-flex h-9 items-center justify-center rounded-md bg-accent px-3.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover">
        Unsuspend account
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  projects: 'Projects',
  activity: 'Activity',
  usage: 'Usage',
  security: 'Security',
};

/** Same `?tab=` query-param device as the rest of the console's filters — no client state, fully linkable. */
function TabBar({ base, active }: { base: string; active: Tab }) {
  return (
    <nav aria-label="Developer detail" className="flex items-center gap-1 border-b border-line">
      {TABS.map((t) => {
        const isActive = t === active;
        return (
          <a
            key={t}
            href={t === 'overview' ? base : `${base}?tab=${t}`}
            aria-current={isActive ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              isActive ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {TAB_LABEL[t]}
          </a>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ developer, now }: { developer: DeveloperDetail; now: number }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="RTC this month" value={`${formatCount(developer.usage.rtcMinutesThisMonth)} min`} />
        <StatCard label="Chat this month" value={`${formatCount(developer.usage.chatMessagesThisMonth)} msgs`} />
        <StatCard label="Live this month" value={`${formatCount(developer.usage.liveMinutesThisMonth)} min`} />
        <StatCard label="API events this month" value={formatCount(developer.usage.apiEventsThisMonth)} />
      </div>

      <section>
        <SectionHeader title="Projects" subtitle={`${formatCount(developer.projects.length)} total`} />
        {developer.overview.recentProjects.length === 0 ? (
          <NoDataYet label="No projects yet" />
        ) : (
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TH>Project</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH align="right">RTC (min)</TH>
                  <TH align="right">Chat (msgs)</TH>
                </THead>
                <TBody>
                  {developer.overview.recentProjects.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <span className="text-sm text-fg">{p.name}</span>
                        {p.isOwner && (
                          <span className="ml-2">
                            <Badge tone="neutral" glyph={false}>
                              Owner
                            </Badge>
                          </span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={p.status === 'ACTIVE' ? 'success' : 'neutral'} glyph={false}>
                          {p.status.toLowerCase()}
                        </Badge>
                      </TD>
                      <TD>
                        <span className="text-xs text-muted">{formatDateTime(p.createdAt)}</span>
                      </TD>
                      <TD align="right">{formatCount(p.rtcMinutes)}</TD>
                      <TD align="right">{formatCount(p.chatMessages)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader title="Recent activity" />
          <Card>
            <ActivityList events={developer.overview.recentActivity} now={now} empty="No activity recorded yet." />
          </Card>
        </section>

        <section>
          <SectionHeader title="Recent security events" />
          <Card>
            <ActivityList events={developer.overview.recentSecurityEvents} now={now} empty="No security events recorded." />
          </Card>
        </section>
      </div>

      <section>
        <SectionHeader title="Recent errors" subtitle="From projects this developer owns." />
        {developer.overview.recentErrors.length === 0 ? (
          <NoDataYet label="No errors recorded" />
        ) : (
          <Card>
            <ul className="flex flex-col gap-2.5">
              {developer.overview.recentErrors.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Badge tone="warning" glyph={false}>
                      <span className="font-mono text-[0.6875rem]">{e.category.replace(/_/g, ' ').toLowerCase()}</span>
                    </Badge>
                    <p className="mt-1 text-fg">{e.message}</p>
                  </div>
                  <time dateTime={e.timestamp} className="shrink-0 text-xs whitespace-nowrap text-subtle">
                    {formatRelative(e.timestamp, now)}
                  </time>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projects tab
// ---------------------------------------------------------------------------

function ProjectsTab({ projects }: { projects: DeveloperProjectRow[] }) {
  if (projects.length === 0) {
    return <EmptyState title="No projects" description="This developer doesn't own or belong to any project." icon={<IconMembers className="size-6" />} />;
  }

  return (
    <TableWrap>
      <Table>
        <THead>
          <TH>Project</TH>
          <TH>Role</TH>
          <TH>Status</TH>
          <TH>Created</TH>
          <TH align="right">RTC (min)</TH>
          <TH align="right">Chat (msgs)</TH>
          <TH align="right">Live (min)</TH>
          <TH align="right">API events</TH>
        </THead>
        <TBody>
          {projects.map((p) => (
            <TR key={p.id}>
              <TD>
                <div className="flex flex-col">
                  <span className="text-sm text-fg">{p.name}</span>
                  <span className="font-mono text-[11px] text-subtle">{p.id}</span>
                </div>
              </TD>
              <TD>
                <span className="text-xs text-muted">{p.role}</span>
                {p.isOwner && (
                  <span className="ml-1.5">
                    <Badge tone="neutral" glyph={false}>
                      Owner
                    </Badge>
                  </span>
                )}
              </TD>
              <TD>
                <Badge tone={p.status === 'ACTIVE' ? 'success' : 'neutral'} glyph={false}>
                  {p.status.toLowerCase()}
                </Badge>
              </TD>
              <TD>
                <span className="text-xs text-muted">{formatDateTime(p.createdAt)}</span>
              </TD>
              <TD align="right">{formatCount(p.rtcMinutes)}</TD>
              <TD align="right">{formatCount(p.chatMessages)}</TD>
              <TD align="right">{formatCount(p.liveMinutes)}</TD>
              <TD align="right">{formatCount(p.apiEvents)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------

function ActivityTab({ events }: { events: ActivityEventSummary[] }) {
  return (
    <Card>
      <CardHeader title="Activity timeline" subtitle="Newest first. Every business and security event recorded against this developer." />
      <ActivityList events={events} now={renderClock()} empty="No activity recorded yet." dense={false} />
    </Card>
  );
}

/**
 * Renders the scannable "HH:mm — Label 'resource'" format from spec §6/§20,
 * e.g. "09:42 — Created project 'VideoApp'".
 */
function ActivityList({ events, now, empty, dense = true }: { events: ActivityEventSummary[]; now: number; empty: string; dense?: boolean }) {
  if (events.length === 0) return <NoDataYet label={empty} />;

  return (
    <ul className={`flex flex-col ${dense ? 'gap-2' : 'gap-3'}`}>
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 text-sm">
          <span
            aria-hidden="true"
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${e.success ? 'bg-subtle' : 'bg-danger'}`}
          />
          <div className="min-w-0 flex-1">
            <span className="font-mono text-xs text-muted">{formatClockTime(e.createdAt)}</span>
            <span className="text-muted"> — </span>
            <span className="text-fg">{eventLabel(e)}</span>
          </div>
          <time dateTime={e.createdAt} className="shrink-0 text-xs whitespace-nowrap text-subtle" title={formatDateTime(e.createdAt)}>
            {formatRelative(e.createdAt, now)}
          </time>
        </li>
      ))}
    </ul>
  );
}

const EVENT_LABEL: Record<string, string> = {
  USER_SIGNED_UP: 'Signed up',
  USER_LOGIN: 'Logged in',
  USER_LOGOUT: 'Logged out',
  LOGIN_FAILED: 'Failed login attempt',
  PASSWORD_CHANGED: 'Changed password',
  OAUTH_CONNECTED: 'Connected OAuth provider',
  PROJECT_CREATED: 'Created project',
  PROJECT_UPDATED: 'Updated project',
  PROJECT_DELETED: 'Deleted project',
  PROJECT_MEMBER_ADDED: 'Added a project member',
  PROJECT_MEMBER_REMOVED: 'Removed a project member',
  API_KEY_CREATED: 'Created an API key',
  API_KEY_REVOKED: 'Revoked an API key',
  API_REQUEST_FAILED: 'API request failed',
  RTC_ROOM_CREATED: 'Created an RTC room',
  RTC_ROOM_ENDED: 'Ended an RTC room',
  RTC_PARTICIPANT_JOINED: 'Joined an RTC room',
  RTC_PARTICIPANT_LEFT: 'Left an RTC room',
  RTC_CONNECTION_FAILED: 'RTC connection failed',
  RTC_RECONNECT: 'RTC reconnected',
  RTC_TOKEN_CREATED: 'Created an RTC token',
  CHAT_CONVERSATION_CREATED: 'Created a conversation',
  CHAT_MEMBER_ADDED: 'Added a chat member',
  CHAT_MESSAGE_SENT: 'Sent a message',
  CHAT_MESSAGE_FAILED: 'Message failed to send',
  LIVE_STREAM_CREATED: 'Created a live stream',
  LIVE_STREAM_STARTED: 'Started a live stream',
  LIVE_STREAM_ENDED: 'Ended a live stream',
  LIVE_STREAM_HOST_JOINED: 'Joined as host',
  LIVE_STREAM_VIEWER_JOINED: 'Viewer joined a live stream',
  LIVE_STREAM_FAILED: 'Live stream failed',
  SUSPICIOUS_ACTIVITY: 'Suspicious activity flagged',
  RATE_LIMIT_TRIGGERED: 'Rate limit triggered',
  ACCOUNT_SUSPENDED: 'Account suspended',
  ACCOUNT_UNSUSPENDED: 'Account unsuspended',
  ADMIN_LOGIN: 'Admin logged in',
  ADMIN_USER_VIEWED: 'Viewed by an admin',
  ADMIN_PROJECT_VIEWED: 'Project viewed by an admin',
  ADMIN_ACCOUNT_SUSPENDED: 'Suspended by an admin',
  ADMIN_ACCOUNT_UNSUSPENDED: 'Unsuspended by an admin',
  ADMIN_LIMIT_CHANGED: 'Limit changed by an admin',
  ADMIN_ACTION: 'Admin action',
};

function eventLabel(e: ActivityEventSummary): string {
  const label = EVENT_LABEL[e.eventType] ?? e.eventType.replace(/_/g, ' ').toLowerCase();
  const metadataName =
    e.metadata && typeof e.metadata === 'object' && 'name' in (e.metadata as Record<string, unknown>)
      ? String((e.metadata as Record<string, unknown>).name)
      : undefined;
  const resource = metadataName ?? e.resourceId;
  return resource ? `${label} '${resource}'` : label;
}

// ---------------------------------------------------------------------------
// Usage tab
// ---------------------------------------------------------------------------

function UsageTab({ developer }: { developer: DeveloperDetail }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="RTC minutes this month" value={formatCount(developer.usage.rtcMinutesThisMonth)} />
        <StatCard label="Chat messages this month" value={formatCount(developer.usage.chatMessagesThisMonth)} />
        <StatCard label="Live minutes this month" value={formatCount(developer.usage.liveMinutesThisMonth)} />
        <StatCard
          label="API requests this month"
          value={formatCount(developer.usage.apiEventsThisMonth)}
          hint="Recorded activity events — the nearest real proxy without per-request logging"
        />
      </div>

      <section>
        <SectionHeader title="Plan &amp; allowances" subtitle="Free-tier allowances tracked per product." />
        {developer.plan.length === 0 ? (
          <NoDataYet label="No allowance has been granted yet" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TH>Product</TH>
                <TH>Source</TH>
                <TH align="right">Included (min)</TH>
                <TH align="right">Consumed (min)</TH>
                <TH align="right">Included (count)</TH>
                <TH align="right">Consumed (count)</TH>
                <TH>Exhausted</TH>
              </THead>
              <TBody>
                {developer.plan.map((a) => (
                  <TR key={a.product}>
                    <TD>
                      <span className="text-sm text-fg">{a.product.replace(/_/g, ' ')}</span>
                    </TD>
                    <TD>
                      <span className="text-xs text-muted">{a.source.replace(/_/g, ' ').toLowerCase()}</span>
                    </TD>
                    <TD align="right">{a.includedMinutes === null ? <Dash /> : formatCount(a.includedMinutes)}</TD>
                    <TD align="right">{formatCount(a.consumedMinutes)}</TD>
                    <TD align="right">{a.includedCount === null ? <Dash /> : formatCount(a.includedCount)}</TD>
                    <TD align="right">{formatCount(a.consumedCount)}</TD>
                    <TD>{a.exhaustedAt ? <Badge tone="warning">{formatDateTime(a.exhaustedAt)}</Badge> : <Dash />}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security tab
// ---------------------------------------------------------------------------

function SecurityTab({ events }: { events: ActivityEventSummary[] }) {
  return (
    <Card>
      <CardHeader
        title="Security events"
        subtitle="Logins, failed logins, password/auth changes, API key lifecycle, suspicious activity, and suspension history."
      />
      <ActivityList events={events} now={renderClock()} empty="No security-relevant events recorded." dense={false} />
    </Card>
  );
}
