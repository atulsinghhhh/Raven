import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi, type ErrorCategory, type ErrorSummary } from '@/lib/api-client';
import { ErrorCategoryBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { DistributionBar } from '@/components/ui/chart';
import { IconErrors } from '@/components/ui/icons';
import { MonoId } from '@/components/ui/mono';
import { PageHeader } from '@/components/ui/page-header';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import {
  MobileField,
  MobileList,
  MobileRow,
  Table,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/table';
import {
  formatCount,
  formatDateTime,
  formatRelative,
  RANGES,
  RANGE_LABEL,
  RANGE_MS,
  RANGE_SHORT,
  type Range,
} from '@/lib/format';

/**
 * Error explorer.
 *
 * Two deliberate constraints shape this page:
 *
 *   1. The list endpoint only supports `category` and `connectionId`
 *      filters, and caps at 200 records. So the category filter is a real
 *      server-side query, while the time window is applied here over the
 *      fetched records — and both are labelled as such rather than
 *      pretending the API can do more than it can.
 *   2. Category counts come from an unfiltered fetch, so switching
 *      category never makes the other counts collapse to zero.
 */

const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  'AUTHENTICATION_ERROR',
  'AUTHORIZATION_ERROR',
  'TOKEN_ERROR',
  'SIGNALING_ERROR',
  'ICE_ERROR',
  'TURN_ERROR',
  'SFU_ERROR',
  'NETWORK_ERROR',
  'CLIENT_ERROR',
  'UNKNOWN_ERROR',
];

const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  AUTHENTICATION_ERROR: 'Authentication',
  AUTHORIZATION_ERROR: 'Authorization',
  TOKEN_ERROR: 'Token',
  SIGNALING_ERROR: 'Signaling',
  ICE_ERROR: 'ICE',
  TURN_ERROR: 'TURN',
  SFU_ERROR: 'SFU',
  NETWORK_ERROR: 'Network',
  CLIENT_ERROR: 'Client',
  UNKNOWN_ERROR: 'Unknown',
};

/**
 * Distribution swatches. Grouped by the same tone families the badges
 * use (auth/token = danger, transport = warning, environmental = info),
 * with opacity steps inside each family so ten categories stay
 * distinguishable without reaching outside the token palette. The legend
 * always names every segment, so colour is never the only signal.
 */
const CATEGORY_SWATCH: Record<ErrorCategory, string> = {
  AUTHENTICATION_ERROR: 'bg-danger',
  AUTHORIZATION_ERROR: 'bg-danger/65',
  TOKEN_ERROR: 'bg-danger/40',
  SIGNALING_ERROR: 'bg-warning',
  ICE_ERROR: 'bg-warning/75',
  TURN_ERROR: 'bg-warning/55',
  SFU_ERROR: 'bg-warning/35',
  NETWORK_ERROR: 'bg-info',
  CLIENT_ERROR: 'bg-info/60',
  UNKNOWN_ERROR: 'bg-line-strong',
};

type WindowKey = Range | 'all';

const FETCH_LIMIT = 200;

export default async function ErrorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ category?: string; window?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;

  // Unrecognised values fall back to "no filter" rather than producing an
  // empty table the developer can't explain.
  const category = ERROR_CATEGORIES.includes(sp.category as ErrorCategory)
    ? (sp.category as ErrorCategory)
    : undefined;
  const windowKey: WindowKey = (RANGES as readonly string[]).includes(sp.window ?? '')
    ? (sp.window as Range)
    : 'all';

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [allResult, filteredResult] = await Promise.allSettled([
    ravenApi.listErrors(token, projectId, { limit: FETCH_LIMIT }),
    category
      ? ravenApi.listErrors(token, projectId, { category, limit: FETCH_LIMIT })
      : Promise.resolve<ErrorSummary[] | null>(null),
  ]);

  const failure =
    allResult.status === 'rejected'
      ? allResult.reason
      : filteredResult.status === 'rejected'
        ? filteredResult.reason
        : null;

  if (failure instanceof ApiError && failure.status === 401) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  if (allResult.status === 'rejected') {
    if (allResult.reason instanceof ApiError && allResult.reason.status === 404) {
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
        title="Could not load errors"
        description="The Control API is unreachable right now. Your telemetry is unaffected — retry in a moment."
        retryHref={`${base}/errors`}
      />
    );
  }

  const now = renderClock();
  const recent = allResult.value;

  // Counts and the distribution are always computed over the unfiltered
  // fetch so the category chips keep their meaning while a filter is on.
  const countable = recent.filter((e) => withinWindow(e.timestamp, windowKey, now));
  const counts = countCategories(countable);

  const rowsSource =
    category != null
      ? filteredResult.status === 'fulfilled' && filteredResult.value
        ? filteredResult.value
        : null
      : recent;
  const rows = rowsSource?.filter((e) => withinWindow(e.timestamp, windowKey, now)) ?? null;

  const filtered = category != null || windowKey !== 'all';
  // Null when no window filter is applied — keeps every "in the last hour"
  // phrase below from having to re-narrow the union.
  const windowLabel = windowKey === 'all' ? null : RANGE_LABEL[windowKey].toLowerCase();
  const newest = countable[0]?.timestamp ?? recent[0]?.timestamp ?? null;
  const distinctCategories = ERROR_CATEGORIES.filter((c) => (counts[c] ?? 0) > 0).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Errors"
        description={`Every error your clients reported through the SDK, newest first. Raven keeps the ${formatCount(FETCH_LIMIT)} most recent records available here.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label={windowKey === 'all' ? 'Errors in recent records' : 'Errors in window'}
          value={formatCount(countable.length)}
          hint={windowKey === 'all' ? `Across the ${FETCH_LIMIT} most recent` : RANGE_LABEL[windowKey]}
          tone={countable.length > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Categories seen"
          value={formatCount(distinctCategories)}
          hint={`of ${ERROR_CATEGORIES.length} possible`}
        />
        <StatCard
          label="Most recent"
          value={newest ? formatRelative(newest, now) : <NoDataYet label="Never" />}
          hint={newest ? formatDateTime(newest) : undefined}
        />
      </div>

      <section>
        <SectionHeader
          title="Filters"
          subtitle={`Category is queried server-side. The time window is applied to the ${FETCH_LIMIT} fetched records here in the console — the errors endpoint has no time parameter.`}
          action={
            filtered ? (
              <a href={`${base}/errors`} className="text-xs font-medium text-accent-text hover:underline">
                Clear filters
              </a>
            ) : undefined
          }
        />
        <Card>
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted">Time window</h3>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip
                  href={filterHref(`${base}/errors`, category, 'all')}
                  active={windowKey === 'all'}
                  label="All fetched records"
                >
                  All
                </FilterChip>
                {RANGES.map((r) => (
                  <FilterChip
                    key={r}
                    href={filterHref(`${base}/errors`, category, r)}
                    active={windowKey === r}
                    label={RANGE_LABEL[r]}
                  >
                    {RANGE_SHORT[r]}
                  </FilterChip>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium text-muted">
                Category
                <span className="ml-1.5 font-normal text-subtle">
                  counts across the {FETCH_LIMIT} most recent errors
                  {windowLabel === null ? '' : `, ${windowLabel}`}
                </span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip
                  href={filterHref(`${base}/errors`, undefined, windowKey)}
                  active={category === undefined}
                  label="All categories"
                  count={countable.length}
                >
                  All categories
                </FilterChip>
                {ERROR_CATEGORIES.map((c) => (
                  <FilterChip
                    key={c}
                    href={filterHref(`${base}/errors`, c, windowKey)}
                    active={category === c}
                    label={`${CATEGORY_LABEL[c]} errors`}
                    count={counts[c] ?? 0}
                  >
                    {CATEGORY_LABEL[c]}
                  </FilterChip>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Category split" subtitle="Where the recent failures are concentrated." />
        <Card>
          <DistributionBar
            segments={ERROR_CATEGORIES.map((c) => ({
              label: CATEGORY_LABEL[c],
              value: counts[c] ?? 0,
              className: CATEGORY_SWATCH[c],
            }))}
            caption={`Error categories across the ${formatCount(countable.length)} most recent errors${
              windowLabel === null ? '' : ` in the ${windowLabel}`
            }.`}
          />
        </Card>
      </section>

      <section>
        <SectionHeader
          title={category ? `${CATEGORY_LABEL[category]} errors` : 'All errors'}
          subtitle={
            rows === null
              ? undefined
              : category
                ? `${formatCount(rows.length)} shown — the ${FETCH_LIMIT} most recent ${CATEGORY_LABEL[category].toLowerCase()} errors${
                    windowLabel === null ? '' : `, narrowed to the ${windowLabel}`
                  }.`
                : `${formatCount(rows.length)} shown — the ${FETCH_LIMIT} most recent errors${
                    windowLabel === null ? '' : `, narrowed to the ${windowLabel}`
                  }.`
          }
        />

        {rows === null ? (
          <ErrorState
            title="Could not load the filtered errors"
            description="The category query failed, but the summary above is still accurate for the most recent records."
            retryHref={filterHref(`${base}/errors`, category, windowKey)}
          />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No errors match this filter"
              description={
                category
                  ? `Nothing was reported as a ${CATEGORY_LABEL[category].toLowerCase()} error${
                      windowLabel === null ? '' : ` in the ${windowLabel}`
                    }. Widen the filter to see what was reported instead.`
                  : `No errors were reported in the ${windowLabel ?? 'selected window'}.`
              }
              icon={<IconErrors className="size-6" />}
              action={
                <ButtonLink href={`${base}/errors`} variant="primary">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              title="No errors recorded"
              description="That is either a good sign or a quiet one: nothing has failed, or nothing has connected yet. Errors appear here automatically once a client using @corvidhq/rtc reports one."
              icon={<IconErrors className="size-6" />}
              action={
                <>
                  <ButtonLink href={`${base}/connections`} variant="primary">
                    View connections
                  </ButtonLink>
                  <ButtonLink href={`${base}/quickstart`} variant="secondary">
                    Open quickstart
                  </ButtonLink>
                </>
              }
            />
          )
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>Error</TH>
                  <TH>Category</TH>
                  <TH>Message</TH>
                  <TH>Connection</TH>
                  <TH align="right">When</TH>
                </THead>
                <TBody>
                  {rows.map((e) => (
                    <TR key={e.publicId} interactive>
                      <TD>
                        <MonoId value={e.publicId} href={`${base}/errors/${e.publicId}`} />
                      </TD>
                      <TD>
                        <ErrorCategoryBadge category={e.category} />
                      </TD>
                      <TD className="max-w-sm">
                        <span className="block truncate text-sm text-fg" title={e.message}>
                          {e.message}
                        </span>
                      </TD>
                      <TD>
                        {e.connectionId ? (
                          <MonoId value={e.connectionId} href={`${base}/connections/${e.connectionId}`} />
                        ) : (
                          <Dash />
                        )}
                      </TD>
                      <TD align="right">
                        <time
                          dateTime={e.timestamp}
                          title={formatDateTime(e.timestamp)}
                          className="tabular text-xs whitespace-nowrap text-subtle"
                        >
                          {formatRelative(e.timestamp, now)}
                        </time>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="sm:hidden">
              <MobileList>
                {rows.map((e) => (
                  <MobileRow key={e.publicId} href={`${base}/errors/${e.publicId}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <ErrorCategoryBadge category={e.category} />
                      <time
                        dateTime={e.timestamp}
                        title={formatDateTime(e.timestamp)}
                        className="tabular shrink-0 text-xs text-subtle"
                      >
                        {formatRelative(e.timestamp, now)}
                      </time>
                    </div>
                    <p className="mb-2 text-sm leading-relaxed text-fg">{e.message}</p>
                    <MobileField label="Error">
                      <span className="font-mono text-xs">{e.publicId}</span>
                    </MobileField>
                    <MobileField label="Connection">
                      {e.connectionId ? <span className="font-mono text-xs">{e.connectionId}</span> : <Dash />}
                    </MobileField>
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
 * One clock read per request. This is an async Server Component — it
 * renders exactly once per navigation, so a single timestamp shared by
 * the window filter and every relative time keeps them consistent with
 * each other instead of drifting mid-render.
 */
function renderClock(): number {
  return Date.now();
}

function countCategories(errors: ErrorSummary[]): Partial<Record<ErrorCategory, number>> {
  const counts: Partial<Record<ErrorCategory, number>> = {};
  for (const e of errors) {
    counts[e.category] = (counts[e.category] ?? 0) + 1;
  }
  return counts;
}

function withinWindow(iso: string, windowKey: WindowKey, now: number): boolean {
  if (windowKey === 'all') return true;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && now - t <= RANGE_MS[windowKey];
}

/** Filters are URL state, so every chip is a plain link — no JS needed. */
function filterHref(base: string, category: ErrorCategory | undefined, windowKey: WindowKey): string {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (windowKey !== 'all') params.set('window', windowKey);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
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
