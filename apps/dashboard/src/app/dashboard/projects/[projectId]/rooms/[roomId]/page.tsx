import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import type { ConnectionSummary, LiveParticipantInfo, LiveTrackInfo } from '@/lib/api-client';
import { Badge, ConnectionQualityBadge, ConnectionStateBadge } from '@/components/ui/badge';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { KeyValue, KeyValueGrid, MonoId } from '@/components/ui/mono';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { IconParticipants } from '@/components/ui/icons';
import { formatCount, formatDateTime, formatDuration, formatMs, formatRelative } from '@/lib/format';
import { TestTokenPanel } from './test-token-panel';

// The room's own connection history is a supporting panel, not the page;
// 50 records is enough to see what has been happening without paging.
const ROOM_CONNECTION_LIMIT = 50;

export default async function RoomDetailPage({ params }: { params: Promise<{ projectId: string; roomId: string }> }) {
  const { projectId, roomId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [roomResult, connectionsResult] = await Promise.allSettled([
    ravenApi.getRoom(token, projectId, roomId),
    ravenApi.listConnections(token, projectId, { roomId, limit: ROOM_CONNECTION_LIMIT }),
  ]);

  const base = `/dashboard/projects/${projectId}`;

  if (roomResult.status === 'rejected') {
    const reason = roomResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    if (reason instanceof ApiError && reason.status === 404) {
      return (
        <EmptyState
          title="Room not found"
          description="This room may have been closed by your backend, or it belongs to a different project."
          action={
            <ButtonLink href={`${base}/rooms`} variant="primary">
              Back to rooms
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this room"
        description="The Control API is unreachable right now. Retry in a moment."
        retryHref={`${base}/rooms/${roomId}`}
      />
    );
  }

  const room = roomResult.value;
  const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value : undefined;
  const liveParticipants = room.liveParticipants;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={room.name}
        breadcrumb={{ label: 'All rooms', href: `${base}/rooms` }}
        description="Live occupancy is read from the SFU each time this page loads; the connection history below comes from stored telemetry."
        meta={<LiveStatusBadge count={room.liveParticipantCount} />}
      />

      <Card>
        <CardHeader title="Room" subtitle="Metadata stored by the Control API." />
        <KeyValueGrid>
          <KeyValue label="Room ID">
            <MonoId value={room.id} copy />
          </KeyValue>
          <KeyValue label="Status">
            <Badge tone={room.status === 'ACTIVE' ? 'success' : 'neutral'}>{room.status}</Badge>
          </KeyValue>
          <KeyValue label="Created">
            <span className="tabular">{formatDateTime(room.createdAt)}</span>
          </KeyValue>
          <KeyValue label="Updated">
            <span className="tabular">{formatDateTime(room.updatedAt)}</span>
          </KeyValue>
        </KeyValueGrid>
      </Card>

      <section>
        <SectionHeader
          title="Live participants"
          subtitle={
            liveParticipants === null
              ? 'Live state could not be read for this room.'
              : `Currently in the room — ${formatCount(liveParticipants.length)} connected.`
          }
        />

        {liveParticipants === null ? (
          <Card>
            {/* null is not zero: the SFU could not be reached, so we say so
                rather than showing an empty room. */}
            <NoDataYet label="SFU unreachable — live state unavailable" />
          </Card>
        ) : liveParticipants.length === 0 ? (
          <EmptyState
            icon={<IconParticipants className="size-7" />}
            title="No one is connected right now"
            description="The room exists and is reachable, but nobody is in it. Participants appear here as soon as a client joins with @corvidhq/rtc."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {liveParticipants.map((participant) => (
              <ParticipantCard key={participant.identity} participant={participant} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader
          title="Live network quality"
          subtitle="From the most recent stats sample of each currently-connected participant — not an all-time average."
        />
        <LiveQualitySummary connections={connections} />
      </section>

      <section>
        <SectionHeader
          title="Recent connections"
          subtitle={`Stored connection records for this room, most recent first (up to ${ROOM_CONNECTION_LIMIT}).`}
          action={
            <a href={`${base}/connections`} className="text-xs font-medium text-accent-text hover:underline">
              All connections
            </a>
          }
        />

        {!connections ? (
          <Card>
            <NoDataYet label="Connection records are unavailable right now" />
          </Card>
        ) : connections.length === 0 ? (
          <EmptyState
            title="No connections recorded for this room"
            description="Connection telemetry is written when a client joins with @corvidhq/rtc. A room created by your backend but never joined has no records."
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Connection</TH>
                    <TH>Participant</TH>
                    <TH>State</TH>
                    <TH align="right">Duration</TH>
                    <TH>Started</TH>
                  </THead>
                  <TBody>
                    {connections.map((connection) => (
                      <TR key={connection.publicId} interactive>
                        <TD>
                          <MonoId value={connection.publicId} href={`${base}/connections/${connection.publicId}`} />
                        </TD>
                        <TD>
                          <span className="truncate text-fg">{connection.participantIdentity}</span>
                        </TD>
                        <TD>
                          <ConnectionStateBadge state={connection.state} />
                        </TD>
                        <TD align="right">
                          <span className="tabular text-muted">{formatDuration(connection.durationMs)}</span>
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
                {connections.map((connection) => (
                  <MobileRow key={connection.publicId} href={`${base}/connections/${connection.publicId}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">
                        {connection.participantIdentity}
                      </span>
                      <ConnectionStateBadge state={connection.state} />
                    </div>
                    <MobileField label="Connection">
                      <span className="font-mono text-xs">{connection.publicId}</span>
                    </MobileField>
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
          </>
        )}
      </section>

      <TestTokenPanel projectId={projectId} roomId={roomId} />
    </div>
  );
}

/**
 * Aggregates the *currently open* connections' last stats sample;
 * closed connections tell you nothing about the room's health right
 * now. "Worst of" for jitter/loss, same reasoning as the connection
 * detail page: for a room someone is actively watching, how bad it
 * gets is more actionable than an average that hides one bad track.
 */
function LiveQualitySummary({ connections }: { connections: ConnectionSummary[] | undefined }) {
  if (!connections) {
    return (
      <Card>
        <NoDataYet label="Connection records are unavailable right now" />
      </Card>
    );
  }

  const live = connections.filter((c) => c.state === 'CONNECTED' || c.state === 'RECONNECTING');
  const withStats = live.filter((c) => c.rttMs !== null || c.jitterMs !== null || c.packetLossPercent !== null);

  if (live.length === 0) {
    return (
      <EmptyState
        title="No one is currently connected"
        description="Quality is only meaningful for an open connection — it reappears here as soon as someone joins."
      />
    );
  }

  if (withStats.length === 0) {
    return (
      <Card>
        <NoDataYet label={`${formatCount(live.length)} connected, but no stats sample has arrived yet`} />
      </Card>
    );
  }

  const rtt = maxOf(withStats, (c) => c.rttMs);
  const jitter = maxOf(withStats, (c) => c.jitterMs);
  const loss = maxOf(withStats, (c) => c.packetLossPercent);
  const worstQuality = worstQualityOf(withStats);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <StatCard
        label="Worst quality"
        value={worstQuality ? <ConnectionQualityBadge quality={worstQuality} /> : <NoDataYet label="Unknown" />}
        hint={`Across ${formatCount(withStats.length)} of ${formatCount(live.length)} connected`}
      />
      <StatCard label="Highest RTT" value={formatMs(rtt) ?? <NoDataYet label="Unknown" />} hint="Send direction" />
      <StatCard label="Highest jitter" value={formatMs(jitter) ?? <NoDataYet label="Unknown" />} hint="Worst track per connection" />
      <StatCard
        label="Highest packet loss"
        value={loss === null ? <NoDataYet label="Unknown" /> : `${loss}%`}
        hint="Worst track per connection"
      />
    </div>
  );
}

/** Numeric worst-of, skipping nulls: a metric no connection reported yet must not drag the max down to itself. */
function maxOf(connections: ConnectionSummary[], pick: (c: ConnectionSummary) => number | null): number | null {
  const values = connections.map(pick).filter((v): v is number => v !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

const QUALITY_RANK: Record<string, number> = { excellent: 0, good: 1, unknown: 2, poor: 3, lost: 4 };

/** The single worst reported quality among live connections: same "worst, not average" reasoning as the numeric fields. */
function worstQualityOf(connections: ConnectionSummary[]): string | null {
  const known = connections
    .map((c) => c.connectionQuality)
    .filter((q): q is Exclude<ConnectionSummary['connectionQuality'], null> => q !== null);
  if (known.length === 0) return null;
  return known.reduce((worst, q) => (QUALITY_RANK[q] > QUALITY_RANK[worst] ? q : worst));
}

function ParticipantCard({ participant }: { participant: LiveParticipantInfo }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-fg">{participant.identity}</span>
        <span className="tabular shrink-0 text-xs text-subtle">{formatRelative(participant.joinedAt)}</span>
      </div>
      <p className="tabular mt-1 text-xs text-muted">Joined {formatDateTime(participant.joinedAt)}</p>
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-medium text-muted">Published tracks</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {participant.tracks.length === 0 ? (
            <NoDataYet label="No published tracks" />
          ) : (
            participant.tracks.map((track) => <TrackBadge key={track.sid} track={track} />)
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Muted state is in the label, not just the tone: a muted video track and a
 * live one must not be told apart by colour alone.
 */
function TrackBadge({ track }: { track: LiveTrackInfo }) {
  const label = track.kind === 'unknown' ? 'track' : track.kind;
  return (
    <Badge tone={track.muted ? 'neutral' : 'success'}>
      <span className="capitalize">{label}</span>
      {track.name ? <span className="font-mono text-[0.6875rem] text-muted">{track.name}</span> : null}
      <span>{track.muted ? '· muted' : '· live'}</span>
    </Badge>
  );
}

function LiveStatusBadge({ count }: { count: number | null }) {
  if (count === null) return <Badge tone="warning">Live state unknown</Badge>;
  if (count > 0) return <Badge tone="success">{formatCount(count)} in room</Badge>;
  return <Badge tone="neutral">Idle</Badge>;
}
