import { redirect } from 'next/navigation';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { StatCard } from '@/components/ui/card';
import { IconErrors } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';
import { getSessionToken } from '@/lib/session';
import { getErrors, type ErrorCategory, type GroupedErrorPage } from '@/lib/super-admin/ops';
import { ApiError } from '@/lib/super-admin-client';

/**
 * Platform-wide error explorer (spec §15): every recurring error
 * signature (category + message), grouped across every project, newest
 * last-seen not implied by default order — the API sorts by count
 * descending, so the loudest recurring failure surfaces first.
 */

const CATEGORIES: ErrorCategory[] = [
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

const CATEGORY_TONE: Record<ErrorCategory, BadgeTone> = {
  AUTHENTICATION_ERROR: 'danger',
  AUTHORIZATION_ERROR: 'danger',
  TOKEN_ERROR: 'warning',
  SIGNALING_ERROR: 'warning',
  ICE_ERROR: 'warning',
  TURN_ERROR: 'warning',
  SFU_ERROR: 'danger',
  NETWORK_ERROR: 'info',
  CLIENT_ERROR: 'neutral',
  UNKNOWN_ERROR: 'neutral',
};

const DEFAULT_LIMIT = 50;

interface SearchParams {
  category?: string;
  offset?: string;
}

export default async function SuperAdminErrorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/errors');

  const category = CATEGORIES.includes(sp.category as ErrorCategory) ? (sp.category as ErrorCategory) : undefined;
  const offset = Math.max(Number.parseInt(sp.offset ?? '0', 10) || 0, 0);

  let page: GroupedErrorPage | null = null;
  let loadError: ApiError | null = null;

  try {
    page = await getErrors(token, { category, limit: DEFAULT_LIMIT, offset });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?next=/super-admin/errors');
    if (err instanceof ApiError) {
      loadError = err;
    } else {
      throw err;
    }
  }

  const base = '/super-admin/errors';
  const totalOccurrences = page ? page.items.reduce((sum, row) => sum + row.count, 0) : 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Errors"
        eyebrow="Operations"
        description="Every distinct error signature (category + message) seen across every project, grouped and counted directly from ErrorEvent — nothing here is sampled."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Error signatures" value={page ? formatCount(page.total) : '—'} hint="Distinct category + message groups" />
        <StatCard label="Occurrences on this page" value={page ? formatCount(totalOccurrences) : '—'} />
        <StatCard
          label="Filter"
          value={category ? formatCategory(category) : 'All categories'}
          hint={category ? undefined : 'Choose a category below to narrow the table'}
        />
      </div>

      <section>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterChip href={hrefWith(sp, { category: undefined })} active={!category}>
            All
          </FilterChip>
          {CATEGORIES.map((c) => (
            <FilterChip key={c} href={hrefWith(sp, { category: c })} active={category === c}>
              {formatCategory(c)}
            </FilterChip>
          ))}
        </div>

        {loadError ? (
          loadError.status === 403 ? (
            <EmptyState
              title="You don't have access to Errors"
              description="Reading the platform error explorer requires Super Admin Portal access."
              icon={<IconErrors className="size-6" />}
            />
          ) : (
            <ErrorState
              title="Could not load errors"
              description="The Control API is unreachable right now. Retry in a moment."
              retryHref={base}
            />
          )
        ) : !page || page.items.length === 0 ? (
          <EmptyState
            title="No errors recorded"
            description="This reads ErrorEvent directly — an empty table means no client SDK has reported an error yet, not that reporting is broken."
            icon={<IconErrors className="size-6" />}
          />
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>Category</TH>
                  <TH>Message</TH>
                  <TH align="right">Count</TH>
                  <TH align="right">Projects</TH>
                  <TH align="right">Developers</TH>
                  <TH>First seen</TH>
                  <TH>Last seen</TH>
                </THead>
                <TBody>
                  {page.items.map((row, i) => (
                    <TR key={`${row.category}-${row.message}-${i}`}>
                      <TD>
                        <Badge tone={CATEGORY_TONE[row.category]}>{formatCategory(row.category)}</Badge>
                      </TD>
                      <TD>
                        <span className="block max-w-md truncate text-sm text-fg" title={row.message}>
                          {row.message}
                        </span>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-fg">{formatCount(row.count)}</span>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-muted">{formatCount(row.affectedProjects)}</span>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-muted">{formatCount(row.affectedDevelopers)}</span>
                      </TD>
                      <TD>
                        <span className="text-xs text-subtle" title={formatDateTime(row.firstSeen)}>
                          {formatRelative(row.firstSeen)}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-xs text-subtle" title={formatDateTime(row.lastSeen)}>
                          {formatRelative(row.lastSeen)}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="sm:hidden">
              <MobileList>
                {page.items.map((row, i) => (
                  <MobileRow key={`${row.category}-${row.message}-${i}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <Badge tone={CATEGORY_TONE[row.category]}>{formatCategory(row.category)}</Badge>
                      <span className="tabular font-mono text-sm text-fg">{formatCount(row.count)}</span>
                    </div>
                    <p className="mb-2 truncate text-xs text-fg" title={row.message}>
                      {row.message}
                    </p>
                    <MobileField label="Projects">{formatCount(row.affectedProjects)}</MobileField>
                    <MobileField label="Developers">{formatCount(row.affectedDevelopers)}</MobileField>
                    <MobileField label="Last seen">{formatRelative(row.lastSeen)}</MobileField>
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

function hrefWith(sp: SearchParams, overrides: Partial<SearchParams>, base = '/super-admin/errors'): string {
  const merged: SearchParams = { ...sp, ...overrides };
  if (!('offset' in overrides)) merged.offset = undefined;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

function formatCategory(category: string): string {
  return category
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
