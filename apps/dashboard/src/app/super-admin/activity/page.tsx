import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { IconEvents } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';
import { getSessionToken } from '@/lib/session';
import {
  ACTIVITY_EVENT_GROUPS,
  ALL_ACTIVITY_EVENT_TYPES,
  type ActivityActorType,
  type ActivityEvent,
  listActivity,
} from '@/lib/super-admin/activity';
import { ApiError } from '@/lib/super-admin-client';

/**
 * Global Activity Explorer (§8): every `ActivityEvent` across the whole
 * platform, filterable and searchable, newest first (the service already
 * orders by `createdAt desc`).
 *
 * At the time this was built only USER_SIGNED_UP/USER_LOGIN/USER_LOGOUT/
 * LOGIN_FAILED are actually wired into `AuthService` — the rest of the
 * ~40 enum values exist and can be filtered on, but nothing emits them
 * yet. The empty state below says that plainly rather than implying the
 * platform is silent.
 */

const ACTOR_TYPES: { value: ActivityActorType; label: string }[] = [
  { value: 'USER', label: 'User' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'SYSTEM', label: 'System' },
  { value: 'API_KEY', label: 'API key' },
];

const DEFAULT_LIMIT = 50;

interface SearchParams {
  q?: string;
  developerId?: string;
  projectId?: string;
  eventType?: string;
  actorType?: string;
  success?: string;
  ipAddress?: string;
  requestId?: string;
  from?: string;
  to?: string;
  offset?: string;
}

export default async function ActivityExplorerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/activity');

  const eventType = (ALL_ACTIVITY_EVENT_TYPES as readonly string[]).includes(sp.eventType ?? '')
    ? sp.eventType
    : undefined;
  const actorType = (ACTOR_TYPES.map((a) => a.value) as readonly string[]).includes(sp.actorType ?? '')
    ? (sp.actorType as ActivityActorType)
    : undefined;
  const success = sp.success === 'true' ? true : sp.success === 'false' ? false : undefined;
  const offset = Math.max(Number.parseInt(sp.offset ?? '0', 10) || 0, 0);

  const filters = {
    search: sp.q || undefined,
    developerId: sp.developerId || undefined,
    projectId: sp.projectId || undefined,
    eventType,
    actorType,
    success,
    ipAddress: sp.ipAddress || undefined,
    requestId: sp.requestId || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    limit: DEFAULT_LIMIT,
    offset,
  };

  let page: { items: ActivityEvent[]; total: number } | null = null;
  let loadError: ApiError | null = null;

  try {
    page = await listActivity(token, filters);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?next=/super-admin/activity');
    if (err instanceof ApiError) {
      loadError = err;
    } else {
      throw err;
    }
  }

  const now = renderClock();
  const base = '/super-admin/activity';
  const hasFilters = Boolean(
    sp.q || sp.developerId || sp.projectId || eventType || actorType || sp.success || sp.ipAddress || sp.requestId || sp.from || sp.to,
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Activity"
        eyebrow="Platform"
        description="Every business and security event recorded across the platform, newest first. This reads directly from the ActivityEvent stream — nothing here is sampled or aggregated."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Matching events"
          value={page ? formatCount(page.total) : <NoDataYet label="Unavailable" />}
          hint={hasFilters ? 'With current filters' : 'All recorded events'}
        />
        <StatCard
          label="Shown on this page"
          value={page ? formatCount(page.items.length) : <NoDataYet label="Unavailable" />}
          hint={`Offset ${formatCount(offset)}, up to ${DEFAULT_LIMIT} per page`}
        />
        <StatCard
          label="Most recent"
          value={page?.items[0] ? formatRelative(page.items[0].createdAt, now) : <NoDataYet label="Never" />}
          hint={page?.items[0] ? formatDateTime(page.items[0].createdAt) : undefined}
        />
      </div>

      <section>
        <SectionHeader
          title="Search"
          subtitle="Matches developer/actor email, resource id, or request id — server-side, case-insensitive."
        />
        <Card>
          <form action={base} method="GET" className="flex flex-col gap-3">
            {/* Preserve every non-search filter already on the URL when the search box is submitted. */}
            {eventType && <input type="hidden" name="eventType" value={eventType} />}
            {actorType && <input type="hidden" name="actorType" value={actorType} />}
            {sp.success && <input type="hidden" name="success" value={sp.success} />}
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Developer email, resource id, or request id…"
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle focus:border-line-strong focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
              >
                Search
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <FilterInput name="developerId" label="Developer id" value={sp.developerId} />
              <FilterInput name="projectId" label="Project id" value={sp.projectId} />
              <FilterInput name="ipAddress" label="IP address" value={sp.ipAddress} />
              <FilterInput name="requestId" label="Request id" value={sp.requestId} />
              <FilterInput name="from" label="From (ISO 8601)" value={sp.from} />
              <FilterInput name="to" label="To (ISO 8601)" value={sp.to} />
            </div>
            <div>
              <button
                type="submit"
                className="inline-flex h-8 items-center justify-center rounded-md border border-line bg-surface px-3 text-xs font-medium text-fg hover:border-line-strong hover:bg-surface-raised"
              >
                Apply filters
              </button>
              {hasFilters && (
                <a href={base} className="ml-3 text-xs font-medium text-accent-text hover:underline">
                  Clear all filters
                </a>
              )}
            </div>
          </form>
        </Card>
      </section>

      <section>
        <SectionHeader title="Status" subtitle="Success or failure." />
        <Card>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip href={hrefWith(sp, { success: undefined })} active={success === undefined}>
              All
            </FilterChip>
            <FilterChip href={hrefWith(sp, { success: 'true' })} active={success === true}>
              Success
            </FilterChip>
            <FilterChip href={hrefWith(sp, { success: 'false' })} active={success === false}>
              Failed
            </FilterChip>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Actor type" />
        <Card>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip href={hrefWith(sp, { actorType: undefined })} active={actorType === undefined}>
              All
            </FilterChip>
            {ACTOR_TYPES.map((a) => (
              <FilterChip key={a.value} href={hrefWith(sp, { actorType: a.value })} active={actorType === a.value}>
                {a.label}
              </FilterChip>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Event type"
          subtitle="Grouped by product. Selecting one narrows the table below; clear it to see everything."
          action={
            eventType ? (
              <a href={hrefWith(sp, { eventType: undefined })} className="text-xs font-medium text-accent-text hover:underline">
                Clear filter
              </a>
            ) : undefined
          }
        />
        <Card>
          <div className="flex flex-col gap-3">
            {Object.entries(ACTIVITY_EVENT_GROUPS).map(([group, types]) => (
              <div key={group}>
                <div className="mono-label mb-1.5 text-[11px] text-muted">{group}</div>
                <div className="flex flex-wrap gap-1.5">
                  {types.map((type) => (
                    <FilterChip key={type} href={hrefWith(sp, { eventType: type })} active={eventType === type}>
                      {formatEventType(type)}
                    </FilterChip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Events"
          subtitle={page ? `${formatCount(page.total)} total, newest first.` : undefined}
        />

        {loadError ? (
          loadError.status === 403 ? (
            <EmptyState
              title="You don't have access to Activity"
              description="Reading the Global Activity Explorer requires Super Admin Portal access. Ask a platform admin if you believe this is wrong."
              icon={<IconEvents className="size-6" />}
            />
          ) : (
            <ErrorState
              title="Could not load activity"
              description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
              retryHref={base}
            />
          )
        ) : !page || page.items.length === 0 ? (
          hasFilters ? (
            <EmptyState
              title="Nothing matches these filters"
              description="No recorded events fit this combination of filters."
              icon={<IconEvents className="size-6" />}
              action={
                <ButtonLink href={base} variant="primary">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              title="No activity recorded yet"
              description="This explorer reads the platform-wide ActivityEvent stream directly — it will fill in as things happen. Right now only account events (sign-up, login, logout, failed login) are wired up to emit events; most of the ~40 event types in the catalog above exist but aren't being written yet, so an empty page here doesn't mean the platform is idle, just that most emission points are still being rolled out."
              icon={<IconEvents className="size-6" />}
            />
          )
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>When</TH>
                  <TH>Event</TH>
                  <TH>Actor</TH>
                  <TH>Project</TH>
                  <TH>Resource</TH>
                  <TH>IP</TH>
                  <TH>Request</TH>
                  <TH align="right">Status</TH>
                </THead>
                <TBody>
                  {page.items.map((event) => (
                    <Fragment key={event.publicId}>
                      <TR>
                        <TD>
                          <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)} className="tabular text-xs whitespace-nowrap text-subtle">
                            {formatRelative(event.createdAt, now)}
                          </time>
                        </TD>
                        <TD>
                          <span className="text-xs text-fg">{formatEventType(event.eventType)}</span>
                        </TD>
                        <TD>
                          {event.actorEmail ? (
                            <span className="text-sm text-fg">{event.actorEmail}</span>
                          ) : (
                            <Dash />
                          )}
                        </TD>
                        <TD>
                          {event.projectId ? (
                            <span className="font-mono text-xs text-muted">{event.projectId}</span>
                          ) : (
                            <Dash />
                          )}
                        </TD>
                        <TD>
                          {event.resourceId ? (
                            <span className="font-mono text-xs text-muted">{event.resourceId}</span>
                          ) : event.resourceType ? (
                            <span className="text-xs text-subtle">{event.resourceType}</span>
                          ) : (
                            <Dash />
                          )}
                        </TD>
                        <TD>
                          {event.ipAddress ? (
                            <span className="font-mono text-xs text-muted">{event.ipAddress}</span>
                          ) : (
                            <Dash />
                          )}
                        </TD>
                        <TD>
                          {event.requestId ? (
                            <span className="font-mono text-xs text-muted">{event.requestId}</span>
                          ) : (
                            <Dash />
                          )}
                        </TD>
                        <TD align="right">
                          <Badge tone={event.success ? 'success' : 'danger'}>{event.success ? 'Success' : 'Failed'}</Badge>
                        </TD>
                      </TR>
                      <tr>
                        <td colSpan={8} className="px-4 py-0 align-middle">
                          <details className="group py-1.5">
                            <summary className="cursor-pointer text-xs font-medium text-muted hover:text-fg">Details</summary>
                            <div className="mt-2 mb-2 flex flex-col gap-1.5 rounded-md border border-line bg-surface-sunken p-3 text-xs">
                              <DetailRow label="Request id" value={event.requestId} />
                              <DetailRow label="IP address" value={event.ipAddress} />
                              <DetailRow label="User agent" value={event.userAgent} />
                              <DetailRow label="Actor id" value={event.actorId} />
                              <DetailRow label="Developer id" value={event.developerId} />
                              <div>
                                <span className="text-muted">Metadata</span>
                                <pre className="mt-1 max-w-full overflow-x-auto rounded-sm bg-surface p-2 font-mono text-[11px] text-fg">
                                  {event.metadata ? JSON.stringify(event.metadata, null, 2) : '—'}
                                </pre>
                              </div>
                            </div>
                          </details>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="sm:hidden">
              <MobileList>
                {page.items.map((event) => (
                  <MobileRow key={event.publicId}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="text-xs font-medium text-fg">{formatEventType(event.eventType)}</span>
                      <Badge tone={event.success ? 'success' : 'danger'}>{event.success ? 'Success' : 'Failed'}</Badge>
                    </div>
                    <MobileField label="When">
                      <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)} className="tabular text-xs">
                        {formatRelative(event.createdAt, now)}
                      </time>
                    </MobileField>
                    <MobileField label="Actor">
                      <span className="text-xs">{event.actorEmail ?? '—'}</span>
                    </MobileField>
                    {event.projectId && (
                      <MobileField label="Project">
                        <span className="font-mono text-xs">{event.projectId}</span>
                      </MobileField>
                    )}
                    {event.resourceId && (
                      <MobileField label="Resource">
                        <span className="font-mono text-xs">{event.resourceId}</span>
                      </MobileField>
                    )}
                    {event.ipAddress && (
                      <MobileField label="IP">
                        <span className="font-mono text-xs">{event.ipAddress}</span>
                      </MobileField>
                    )}
                    {event.requestId && (
                      <MobileField label="Request">
                        <span className="font-mono text-xs">{event.requestId}</span>
                      </MobileField>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-muted hover:text-fg">Metadata</summary>
                      <pre className="mt-1.5 max-w-full overflow-x-auto rounded-sm border border-line bg-surface-sunken p-2 font-mono text-[11px] text-fg">
                        {event.metadata ? JSON.stringify(event.metadata, null, 2) : '—'}
                      </pre>
                    </details>
                  </MobileRow>
                ))}
              </MobileList>
            </div>

            <Pagination base={base} sp={sp} offset={offset} limit={DEFAULT_LIMIT} total={page.total} shown={page.items.length} />
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
 * drifting mid-render. Same reasoning as the audit page, and wrapping it
 * in a named function (rather than calling `Date.now()` inline) is what
 * satisfies the `react-hooks/purity` lint rule, which otherwise flags any
 * direct impure call in component body.
 */
function renderClock(): number {
  return Date.now();
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted">{label}:</span>
      <span className="min-w-0 truncate font-mono text-fg">{value}</span>
    </div>
  );
}

function Pagination({
  base,
  sp,
  offset,
  limit,
  total,
  shown,
}: {
  base: string;
  sp: SearchParams;
  offset: number;
  limit: number;
  total: number;
  shown: number;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = offset + shown;
  const hasPrev = offset > 0;
  const hasNext = end < total;

  return (
    <div className="mt-3 flex items-center justify-between">
      <p className="text-xs text-subtle">
        {formatCount(start)}–{formatCount(end)} of {formatCount(total)}
      </p>
      <div className="flex gap-2">
        <ButtonLink
          href={hrefWith(sp, { offset: hasPrev ? String(Math.max(offset - limit, 0)) : undefined }, base)}
          variant="secondary"
          size="sm"
          aria-disabled={!hasPrev}
          className={!hasPrev ? 'pointer-events-none opacity-40' : ''}
        >
          Previous
        </ButtonLink>
        <ButtonLink
          href={hrefWith(sp, { offset: hasNext ? String(offset + limit) : undefined }, base)}
          variant="secondary"
          size="sm"
          aria-disabled={!hasNext}
          className={!hasNext ? 'pointer-events-none opacity-40' : ''}
        >
          Next
        </ButtonLink>
      </div>
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-accent-line bg-accent-subtle text-accent-text'
          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
      }`}
    >
      {children}
    </a>
  );
}

function FilterInput({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono-label text-[10px] text-muted">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={value ?? ''}
        className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-fg placeholder:text-subtle focus:border-line-strong focus:outline-none"
      />
    </label>
  );
}

/**
 * Builds an href for `/super-admin/activity` carrying every current filter
 * plus the given overrides (an `undefined` override removes that key).
 * Changing any filter this way resets `offset` back to the first page,
 * since a different filter set makes the old offset meaningless — except
 * pagination links, which pass `offset` explicitly as their only override.
 */
function hrefWith(sp: SearchParams, overrides: Partial<SearchParams>, base = '/super-admin/activity'): string {
  const merged: SearchParams = { ...sp, ...overrides };
  if (!('offset' in overrides)) {
    merged.offset = undefined;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/** "RTC_ROOM_CREATED" -> "Rtc room created": readable without a lookup table for all ~40 values. */
function formatEventType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
