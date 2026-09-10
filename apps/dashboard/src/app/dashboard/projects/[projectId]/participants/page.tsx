import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import type { ConnectionSummary } from '@/lib/api-client';
import { ConnectionStateBadge } from '@/components/ui/badge';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ProductTabs, rtcTabs } from '@/components/shell/product-tabs';
import { Button, ButtonLink } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { KeyValue, KeyValueGrid, MonoId } from '@/components/ui/mono';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { IconParticipants } from '@/components/ui/icons';
import { formatCount, formatDateTime, formatDuration, formatRelative } from '@/lib/format';

/**
 * There is no participants endpoint on the Control API: a participant is not
 * a stored resource. Everything on this page is derived from connection
 * records, grouped by participantIdentity, and is therefore a view of the most
 * recent CONNECTION_SCAN_LIMIT records, not a complete roster. The UI
 * repeats that caveat wherever a number could otherwise be read as all-time.
 */
const CONNECTION_SCAN_LIMIT = 200;

interface DerivedParticipant {
  identity: string;
  rooms: string[];
  latest: ConnectionSummary;
  connections: ConnectionSummary[];
  totalDurationMs: number | null;
}

export default async function ParticipantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { projectId } = await params;
  const rawQuery = (await searchParams).q ?? '';
  const query = rawQuery.trim();

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  let connections: ConnectionSummary[];
  try {
    connections = await ravenApi.listConnections(token, projectId, { limit: CONNECTION_SCAN_LIMIT });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="Project not found"
          description="This project may have been archived, or it belongs to a different account."
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
        title="Could not load participants"
        description="Participants are derived from connection records, and the Control API is unreachable right now."
        retryHref={`${base}/participants`}
      />
    );
  }

  const participants = deriveParticipants(connections);
  const needle = query.toLowerCase();
  const matches = needle ? participants.filter((p) => p.identity.toLowerCase().includes(needle)) : participants;
  const connectedNow = participants.filter((p) => p.latest.state === 'CONNECTED').length;

  // When the filter resolves to exactly one identity, their own connection
  // records are worth showing in full: that is the closest thing to a
  // participant detail view the API can actually back.
  const focused = query && matches.length === 1 ? matches[0] : undefined;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Participants"
        description={`Derived from the ${CONNECTION_SCAN_LIMIT} most recent connection records in this project, grouped by participant identity. Livqeno does not store participants as a separate resource, so this is a recent-activity view rather than a complete historical roster.`}
      />
      <ProductTabs tabs={rtcTabs(base)} active="Participants" />

      {participants.length === 0 ? (
        <EmptyState
          icon={<IconParticipants className="size-7" />}
          title="No participants yet"
          description={
            <>
              A participant appears here as soon as a client joins a room with{' '}
              <code className="font-mono text-xs text-fg">@ravenkash/rtc</code> using a token minted by your backend. Until
              then there are no connection records to derive one from.
            </>
          }
          action={
            <>
              <ButtonLink href={`${base}/quickstart`} variant="primary">
                Open quickstart
              </ButtonLink>
              <ButtonLink href={`${base}/rooms`} variant="secondary">
                View rooms
              </ButtonLink>
            </>
          }
        />
      ) : (
        <>
          <section>
            <SectionHeader title="Recent activity" subtitle="Counted across the scanned connection records only." />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="Participants seen"
                value={formatCount(participants.length)}
                hint={`Across ${formatCount(connections.length)} connection records`}
              />
              <StatCard
                label="Connected now"
                value={formatCount(connectedNow)}
                hint="Latest record for each identity is Connected"
              />
              <StatCard
                label="Connection records scanned"
                value={formatCount(connections.length)}
                hint={`Most recent ${CONNECTION_SCAN_LIMIT} maximum`}
              />
            </div>
          </section>

          <section>
            <SectionHeader
              title={query ? `Participants matching “${query}”` : 'All participants'}
              subtitle={`${formatCount(matches.length)} of ${formatCount(participants.length)} identities.`}
            />

            {/* Plain GET form — filtering works with JavaScript disabled and
                the resulting URL is shareable. The ⌘K palette links here. */}
            <form method="get" role="search" className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="participant-query" className="sr-only">
                Filter by participant identity
              </label>
              <Input
                id="participant-query"
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Filter by identity…"
                className="w-full sm:w-72"
              />
              <Button type="submit" variant="secondary">
                Filter
              </Button>
              {query && (
                <ButtonLink href={`${base}/participants`} variant="ghost">
                  Clear
                </ButtonLink>
              )}
            </form>

            {matches.length === 0 ? (
              <EmptyState
                title={`No participant matches “${query}”`}
                description="Identities are matched against the scanned connection records. An identity that has not connected recently will not appear here."
                action={
                  <ButtonLink href={`${base}/participants`} variant="secondary">
                    Clear filter
                  </ButtonLink>
                }
              />
            ) : (
              <>
                <div className="hidden sm:block">
                  <TableWrap>
                    <Table>
                      <THead>
                        <TH>Participant</TH>
                        <TH>Rooms</TH>
                        <TH>Latest state</TH>
                        <TH align="right">Connections</TH>
                        <TH align="right">Total time</TH>
                        <TH>Last seen</TH>
                        <TH>SDK</TH>
                      </THead>
                      <TBody>
                        {matches.map((participant) => (
                          <TR key={participant.identity} interactive>
                            <TD>
                              <a
                                href={`${base}/participants?q=${encodeURIComponent(participant.identity)}`}
                                className="font-medium text-fg hover:text-accent-text hover:underline"
                              >
                                {participant.identity}
                              </a>
                            </TD>
                            <TD>
                              <span className="text-muted">{participant.rooms.join(', ')}</span>
                            </TD>
                            <TD>
                              <ConnectionStateBadge state={participant.latest.state} />
                            </TD>
                            <TD align="right">
                              <span className="tabular text-fg">{formatCount(participant.connections.length)}</span>
                            </TD>
                            <TD align="right">
                              {participant.totalDurationMs === null ? (
                                <Dash />
                              ) : (
                                <span className="tabular text-muted">{formatDuration(participant.totalDurationMs)}</span>
                              )}
                            </TD>
                            <TD>
                              <span className="tabular text-xs text-muted">
                                {formatRelative(participant.latest.startedAt)}
                              </span>
                            </TD>
                            <TD>
                              {participant.latest.sdkVersion ? (
                                <span className="font-mono text-xs text-muted">{participant.latest.sdkVersion}</span>
                              ) : (
                                <Dash />
                              )}
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>
                </div>

                <div className="sm:hidden">
                  <MobileList>
                    {matches.map((participant) => (
                      <MobileRow
                        key={participant.identity}
                        href={`${base}/participants?q=${encodeURIComponent(participant.identity)}`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-medium text-fg">{participant.identity}</span>
                          <ConnectionStateBadge state={participant.latest.state} />
                        </div>
                        <MobileField label="Rooms">{participant.rooms.join(', ')}</MobileField>
                        <MobileField label="Connections">
                          <span className="tabular">{formatCount(participant.connections.length)}</span>
                        </MobileField>
                        <MobileField label="Total time">
                          {participant.totalDurationMs === null ? (
                            <Dash />
                          ) : (
                            <span className="tabular">{formatDuration(participant.totalDurationMs)}</span>
                          )}
                        </MobileField>
                        <MobileField label="Last seen">
                          <span className="tabular">{formatRelative(participant.latest.startedAt)}</span>
                        </MobileField>
                        <MobileField label="SDK">{participant.latest.sdkVersion ?? <Dash />}</MobileField>
                      </MobileRow>
                    ))}
                  </MobileList>
                </div>
              </>
            )}
          </section>

          {focused && <ParticipantConnections base={base} participant={focused} />}
        </>
      )}
    </div>
  );
}

function ParticipantConnections({ base, participant }: { base: string; participant: DerivedParticipant }) {
  const latest = participant.latest;

  return (
    <section>
      <SectionHeader
        title={`Connections for ${participant.identity}`}
        subtitle="Every scanned connection record for this identity, most recent first."
      />

      <Card className="mb-3">
        <KeyValueGrid>
          <KeyValue label="Latest state">
            <ConnectionStateBadge state={latest.state} />
          </KeyValue>
          <KeyValue label="Last connection">
            <MonoId value={latest.publicId} href={`${base}/connections/${latest.publicId}`} />
          </KeyValue>
          <KeyValue label="Last duration">
            <span className="tabular">{formatDuration(latest.durationMs)}</span>
          </KeyValue>
          <KeyValue label="Last seen">
            <span className="tabular">{formatDateTime(latest.startedAt)}</span>
          </KeyValue>
        </KeyValueGrid>
      </Card>

      <div className="hidden sm:block">
        <TableWrap>
          <Table>
            <THead>
              <TH>Connection</TH>
              <TH>Room</TH>
              <TH>State</TH>
              <TH align="right">Duration</TH>
              <TH align="right">Reconnects</TH>
              <TH>Started</TH>
            </THead>
            <TBody>
              {participant.connections.map((connection) => (
                <TR key={connection.publicId} interactive>
                  <TD>
                    <MonoId value={connection.publicId} href={`${base}/connections/${connection.publicId}`} />
                  </TD>
                  <TD>
                    {connection.roomId ? (
                      <a href={`${base}/rooms/${connection.roomId}`} className="text-fg hover:text-accent-text hover:underline">
                        {connection.roomName}
                      </a>
                    ) : (
                      <span className="text-muted">{connection.roomName}</span>
                    )}
                  </TD>
                  <TD>
                    <ConnectionStateBadge state={connection.state} />
                  </TD>
                  <TD align="right">
                    <span className="tabular text-muted">{formatDuration(connection.durationMs)}</span>
                  </TD>
                  <TD align="right">
                    <span className="tabular text-muted">{formatCount(connection.reconnectCount)}</span>
                  </TD>
                  <TD>
                    <span className="tabular text-xs text-muted">{formatDateTime(connection.startedAt)}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </div>

      <div className="sm:hidden">
        <MobileList>
          {participant.connections.map((connection) => (
            <MobileRow key={connection.publicId} href={`${base}/connections/${connection.publicId}`}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-xs text-fg">{connection.publicId}</span>
                <ConnectionStateBadge state={connection.state} />
              </div>
              <MobileField label="Room">{connection.roomName}</MobileField>
              <MobileField label="Duration">
                <span className="tabular">{formatDuration(connection.durationMs)}</span>
              </MobileField>
              <MobileField label="Started">
                <span className="tabular">{formatRelative(connection.startedAt)}</span>
              </MobileField>
            </MobileRow>
          ))}
        </MobileList>
      </div>
    </section>
  );
}

/**
 * Groups connection records by identity. Records are ordered newest-first per
 * identity so "latest" is unambiguous regardless of the order the API returned
 * them in; total duration stays null when no record has a recorded duration,
 * so an in-progress connection never reads as "0s".
 */
function deriveParticipants(connections: ConnectionSummary[]): DerivedParticipant[] {
  const byIdentity = new Map<string, ConnectionSummary[]>();

  for (const connection of connections) {
    const identity = connection.participantIdentity;
    if (!identity) continue;
    const existing = byIdentity.get(identity);
    if (existing) existing.push(connection);
    else byIdentity.set(identity, [connection]);
  }

  const participants: DerivedParticipant[] = [];

  for (const [identity, records] of byIdentity) {
    const ordered = [...records].sort((a, b) => startedAtMs(b) - startedAtMs(a));
    const withDuration = ordered.filter((c) => c.durationMs !== null);

    participants.push({
      identity,
      rooms: [...new Set(ordered.map((c) => c.roomName).filter(Boolean))],
      latest: ordered[0],
      connections: ordered,
      totalDurationMs:
        withDuration.length > 0 ? withDuration.reduce((sum, c) => sum + (c.durationMs ?? 0), 0) : null,
    });
  }

  return participants.sort((a, b) => startedAtMs(b.latest) - startedAtMs(a.latest));
}

function startedAtMs(connection: ConnectionSummary): number {
  const ms = new Date(connection.startedAt).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
