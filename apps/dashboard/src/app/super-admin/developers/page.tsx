import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import {
  listDevelopers,
  type DeveloperAccountStatus,
  type DeveloperSortField,
  type RiskLevel,
  type SortDir,
} from '@/lib/super-admin/developers';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { IconMembers } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Card, StatCard } from '@/components/ui/card';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead } from '@/components/ui/table';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';
import { DeveloperRow } from './developer-row';

/**
 * One clock read per request, same reasoning as the project audit log
 * page: this is an async Server Component that renders exactly once per
 * navigation, so every relative timestamp on the page should share one
 * `now` rather than each computing its own and drifting mid-render.
 */
function renderClock(): number {
  return Date.now();
}

/**
 * The developer directory (spec §5) — the entry point into every other
 * per-developer view in the portal. Search, status filter, date-created
 * range, column sort, and pagination are all plain query params so the
 * page stays a server component and every state is a shareable URL, same
 * convention as the project audit log page.
 */

const BASE = '/super-admin/developers';
const PAGE_SIZE = 25;
const SORT_FIELDS: DeveloperSortField[] = ['name', 'email', 'createdAt', 'status'];

interface SearchParams {
  search?: string;
  status?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortDir?: string;
  page?: string;
}

export default async function DevelopersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const search = sp.search?.trim() || undefined;
  const status: DeveloperAccountStatus | undefined =
    sp.status === 'ACTIVE' || sp.status === 'SUSPENDED' ? sp.status : undefined;
  const from = sp.from || undefined;
  const to = sp.to || undefined;
  const sortBy: DeveloperSortField = SORT_FIELDS.includes(sp.sortBy as DeveloperSortField)
    ? (sp.sortBy as DeveloperSortField)
    : 'createdAt';
  const sortDir: SortDir = sp.sortDir === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let result;
  try {
    result = await listDevelopers(token, { search, status, from, to, sortBy, sortDir, limit: PAGE_SIZE, offset });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login');
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="flex flex-col gap-8">
          <PageHeader title="Developers" description="Every developer account on the platform." />
          <EmptyState
            title="Your platform role does not permit this"
            description="Reading the developer directory requires Super Admin Portal access. Ask a Super Admin if you believe this is wrong."
            icon={<IconMembers className="size-6" />}
          />
        </div>
      );
    }
    return (
      <ErrorState
        title="Could not load the developer directory"
        description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
        retryHref={BASE}
      />
    );
  }

  const now = renderClock();
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current: Record<string, string | undefined> = { search, status, from, to, sortBy, sortDir };

  const activeCount = result.items.filter((d) => d.status === 'ACTIVE').length;
  const atRiskCount = result.items.filter((d) => d.riskLevel === 'HIGH' || d.riskLevel === 'CRITICAL').length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Developers"
        description="Every developer account on the platform: usage, plan, and risk status at a glance. Click a row to open the full detail view."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total developers" value={formatCount(result.total)} />
        <StatCard label="On this page" value={formatCount(result.items.length)} hint={`${activeCount} active`} />
        <StatCard
          label="Elevated risk (page)"
          value={formatCount(atRiskCount)}
          tone={atRiskCount > 0 ? 'warning' : 'default'}
          hint="High or critical"
        />
        <StatCard label="Page" value={`${page} / ${totalPages}`} hint={`${PAGE_SIZE} per page`} />
      </div>

      <Card>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <label htmlFor="search" className="mono-label text-[11px] text-muted">
              Search
            </label>
            <input
              id="search"
              name="search"
              defaultValue={search ?? ''}
              placeholder="Name or email"
              className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:border-line-strong focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="from" className="mono-label text-[11px] text-muted">
              Created from
            </label>
            <input
              id="from"
              type="date"
              name="from"
              defaultValue={from ?? ''}
              className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-fg focus:border-line-strong focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="to" className="mono-label text-[11px] text-muted">
              Created to
            </label>
            <input
              id="to"
              type="date"
              name="to"
              defaultValue={to ?? ''}
              className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-fg focus:border-line-strong focus:outline-none"
            />
          </div>
          <input type="hidden" name="sortBy" value={sortBy} />
          <input type="hidden" name="sortDir" value={sortDir} />
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Apply
          </button>
          {(search || from || to || status) && (
            <ButtonLink href={BASE} size="sm" variant="ghost">
              Clear all filters
            </ButtonLink>
          )}
        </form>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <FilterChip href={hrefFor(current, { status: undefined })} active={!status}>
            All statuses
          </FilterChip>
          <FilterChip href={hrefFor(current, { status: 'ACTIVE' })} active={status === 'ACTIVE'}>
            Active
          </FilterChip>
          <FilterChip href={hrefFor(current, { status: 'SUSPENDED' })} active={status === 'SUSPENDED'}>
            Suspended
          </FilterChip>
        </div>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState
          title={search || status || from || to ? 'No developers match these filters' : 'No developers yet'}
          description={
            search || status || from || to
              ? 'Try widening the search or clearing a filter.'
              : 'Developer accounts appear here as soon as someone signs up.'
          }
          icon={<IconMembers className="size-6" />}
          action={
            search || status || from || to ? (
              <ButtonLink href={BASE} variant="primary">
                Clear filters
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <>
          <TableWrap className="hidden lg:block">
            <Table>
              <THead>
                <SortableTH field="name" label="Developer" current={current} sortBy={sortBy} sortDir={sortDir} />
                <SortableTH field="email" label="Email" current={current} sortBy={sortBy} sortDir={sortDir} />
                <SortableTH field="status" label="Status" current={current} sortBy={sortBy} sortDir={sortDir} />
                <SortableTH field="createdAt" label="Created" current={current} sortBy={sortBy} sortDir={sortDir} />
                <TH>Last active</TH>
                <TH align="right">Projects</TH>
                <TH align="right">RTC (min)</TH>
                <TH align="right">Chat (msgs)</TH>
                <TH align="right">Live (min)</TH>
                <TH align="right">API events</TH>
                <TH>Risk</TH>
              </THead>
              <TBody>
                {result.items.map((dev) => (
                  <DeveloperRow key={dev.id} href={`${BASE}/${dev.id}`}>
                    <TD>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-fg">{dev.name ?? <Dash />}</span>
                        <span className="font-mono text-[11px] text-subtle">{dev.id}</span>
                      </div>
                    </TD>
                    <TD>
                      <span className="text-sm text-fg">{dev.email}</span>
                    </TD>
                    <TD>
                      <StatusBadge status={dev.status} />
                    </TD>
                    <TD>
                      <span className="text-xs text-muted">{formatDateTime(dev.createdAt)}</span>
                    </TD>
                    <TD>
                      <span className="text-xs text-muted">
                        {dev.lastActiveAt ? formatRelative(dev.lastActiveAt, now) : <NoDataYet label="Never" />}
                      </span>
                    </TD>
                    <TD align="right">
                      <span className="tabular text-sm text-fg">{formatCount(dev.projectsCount)}</span>
                    </TD>
                    <TD align="right">
                      <span className="tabular text-sm text-fg">{formatCount(dev.rtcMinutesThisMonth)}</span>
                    </TD>
                    <TD align="right">
                      <span className="tabular text-sm text-fg">{formatCount(dev.chatMessagesThisMonth)}</span>
                    </TD>
                    <TD align="right">
                      <span className="tabular text-sm text-fg">{formatCount(dev.liveMinutesThisMonth)}</span>
                    </TD>
                    <TD align="right">
                      <span className="tabular text-sm text-fg">{formatCount(dev.apiEventsThisMonth)}</span>
                    </TD>
                    <TD>
                      <RiskBadge level={dev.riskLevel} />
                    </TD>
                  </DeveloperRow>
                ))}
              </TBody>
            </Table>
          </TableWrap>

          <div className="lg:hidden">
            <MobileList>
              {result.items.map((dev) => (
                <MobileRow key={dev.id} href={`${BASE}/${dev.id}`}>
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{dev.name ?? dev.email}</p>
                      <p className="truncate text-xs text-muted">{dev.email}</p>
                    </div>
                    <StatusBadge status={dev.status} />
                  </div>
                  <MobileField label="Risk">
                    <RiskBadge level={dev.riskLevel} />
                  </MobileField>
                  <MobileField label="Created">{formatDateTime(dev.createdAt)}</MobileField>
                  <MobileField label="Last active">
                    {dev.lastActiveAt ? formatRelative(dev.lastActiveAt, now) : 'Never'}
                  </MobileField>
                  <MobileField label="Projects">{formatCount(dev.projectsCount)}</MobileField>
                  <MobileField label="RTC / Chat / Live">
                    {formatCount(dev.rtcMinutesThisMonth)}m / {formatCount(dev.chatMessagesThisMonth)} /{' '}
                    {formatCount(dev.liveMinutesThisMonth)}m
                  </MobileField>
                </MobileRow>
              ))}
            </MobileList>
          </div>

          <Pagination current={current} page={page} totalPages={totalPages} />
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DeveloperAccountStatus }) {
  return status === 'ACTIVE' ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>;
}

const RISK_TONE: Record<RiskLevel, BadgeTone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' };
const RISK_LABEL: Record<RiskLevel, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };

function RiskBadge({ level }: { level: RiskLevel }) {
  return <Badge tone={RISK_TONE[level]}>{RISK_LABEL[level]}</Badge>;
}

function hrefFor(current: Record<string, string | undefined>, overrides: Record<string, string | undefined>): string {
  const merged = { ...current, ...overrides };
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) qs.set(key, value);
  }
  const query = qs.toString();
  return query ? `${BASE}?${query}` : BASE;
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

function SortableTH({
  field,
  label,
  current,
  sortBy,
  sortDir,
}: {
  field: DeveloperSortField;
  label: string;
  current: Record<string, string | undefined>;
  sortBy: DeveloperSortField;
  sortDir: SortDir;
}) {
  const active = sortBy === field;
  const nextDir: SortDir = active && sortDir === 'asc' ? 'desc' : 'asc';
  const href = hrefFor(current, { sortBy: field, sortDir: nextDir });
  return (
    <TH>
      <a href={href} className={`inline-flex items-center gap-1 hover:text-fg ${active ? 'text-fg' : ''}`}>
        {label}
        {active && <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </a>
    </TH>
  );
}

function Pagination({
  current,
  page,
  totalPages,
}: {
  current: Record<string, string | undefined>;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  const prevHref = page > 1 ? hrefFor(current, { page: String(page - 1) }) : undefined;
  const nextHref = page < totalPages ? hrefFor(current, { page: String(page + 1) }) : undefined;

  return (
    <div className="flex items-center justify-between border-t border-line pt-4">
      <span className="text-xs text-muted">
        Page {formatCount(page)} of {formatCount(totalPages)}
      </span>
      <div className="flex gap-2">
        <ButtonLink href={prevHref ?? '#'} size="sm" variant="secondary" aria-disabled={!prevHref} className={!prevHref ? 'pointer-events-none opacity-40' : ''}>
          Previous
        </ButtonLink>
        <ButtonLink href={nextHref ?? '#'} size="sm" variant="secondary" aria-disabled={!nextHref} className={!nextHref ? 'pointer-events-none opacity-40' : ''}>
          Next
        </ButtonLink>
      </div>
    </div>
  );
}
