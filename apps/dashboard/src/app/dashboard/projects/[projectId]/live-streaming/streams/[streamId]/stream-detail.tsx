'use client';

import { useCallback, useState } from 'react';
import type { ChatMessageSummary, LiveStreamSummary } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, SectionHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { KeyValue, KeyValueGrid, MonoId } from '@/components/ui/mono';
import { Dash, EmptyState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime } from '@/lib/format';
import { useDashboardRealtime } from '@/lib/realtime/use-dashboard-realtime';
import { useDebouncedRefetch } from '@/lib/realtime/use-debounced-refetch';
import type { DashboardRealtimeSocketFactory } from '@/lib/realtime/dashboard-realtime-transport';

function StreamStatusBadge({ status }: { status: LiveStreamSummary['status'] }) {
  if (status === 'LIVE') return <Badge tone="live">Live</Badge>;
  if (status === 'ENDED') return <Badge tone="neutral">Ended</Badge>;
  if (status === 'CREATED') return <Badge tone="info">Created</Badge>;
  return <Badge tone="warning">{status.toLowerCase()}</Badge>;
}

const MESSAGE_SCAN_LIMIT = 100;

/**
 * Everything below the page header on the stream detail page: metadata,
 * host list, viewer counts, chat activity, reactions, and the timeline —
 * the part that needs to be a client component so it can subscribe to
 * dashboard realtime and refresh when *this* stream starts or ends (Phase
 * 5E). Split out from page.tsx (a Server Component) the same way
 * StreamsList/RoomsList/ConnectionsList/WebhooksManager were.
 *
 * `messages` stays exactly what page.tsx fetched server-side and never
 * live-updates here — chat activity is out of this phase's scope (see
 * Phase 5E's RTC/Chat boundary rules). Only `stream` itself refreshes.
 */
export function StreamDetail({
  projectId,
  streamId,
  basePath,
  initialStream,
  messages,
  realtimeSocketFactory,
}: {
  projectId: string;
  streamId: string;
  /** The Streams list page, for the PageHeader breadcrumb. */
  basePath: string;
  initialStream: LiveStreamSummary;
  messages: ChatMessageSummary[] | undefined;
  /** Test-only seam, threaded straight through to useDashboardRealtime. Never set in application code. */
  realtimeSocketFactory?: DashboardRealtimeSocketFactory;
}) {
  const [stream, setStream] = useState(initialStream);

  /**
   * Refetches this one stream's detail and replaces it wholesale — unlike
   * the list pages, there is nothing to merge: a detail view holds
   * exactly one record. This is also the one place a `live_stream.*`
   * nudge earns its keep beyond the status badge: `getLiveStream` polls
   * the SFU for `viewerCount`, so a refetch here is the only way this
   * page's live viewer count ever moves without a manual reload.
   */
  const refetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/live-streams/${streamId}`);
      if (!res.ok) return; // background nudge — fails silently, same as every other realtime page
      const fresh = (await res.json()) as LiveStreamSummary;
      setStream(fresh);
    } catch {
      // Silent — the next successful nudge/reconnect/manual reload catches up.
    }
  }, [projectId, streamId]);

  const scheduleRefetch = useDebouncedRefetch(refetchLatest);

  const handleRealtimeEvent = useCallback(
    (frame: Record<string, unknown>) => {
      if (frame.type !== 'live_stream.started' && frame.type !== 'live_stream.ended') return;
      // Scoped to this one stream — an optimization, never an
      // authorization mechanism (the server already scoped the event to
      // this project before it reached the socket): an event about a
      // different stream in the same project can't affect this page.
      if (frame.streamId !== streamId) return;
      scheduleRefetch();
    },
    [streamId, scheduleRefetch],
  );

  useDashboardRealtime(projectId, {
    onEvent: handleRealtimeEvent,
    onReconnected: refetchLatest,
    socketFactory: realtimeSocketFactory,
  });

  const rootMessage = messages?.find((m) => m.id === stream.chatRootMessageId);

  return (
    <>
      <PageHeader
        title={stream.title}
        breadcrumb={{ label: 'All streams', href: basePath }}
        description={stream.description ?? 'No description set.'}
        meta={<StreamStatusBadge status={stream.status} />}
      />

      <Card>
        <CardHeader title="Stream" subtitle="Metadata stored by the Control API." />
        <KeyValueGrid>
          <KeyValue label="Stream ID">
            <MonoId value={stream.id} copy />
          </KeyValue>
          <KeyValue label="Visibility">
            <span className="capitalize">{stream.visibility.toLowerCase()}</span>
          </KeyValue>
          <KeyValue label="Category">{stream.category ?? <Dash />}</KeyValue>
          <KeyValue label="Language">{stream.language ?? <Dash />}</KeyValue>
          <KeyValue label="Created">
            <span className="tabular">{formatDateTime(stream.createdAt)}</span>
          </KeyValue>
          <KeyValue label="Updated">
            <span className="tabular">{formatDateTime(stream.updatedAt)}</span>
          </KeyValue>
        </KeyValueGrid>
        {stream.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
            {stream.tags.map((tag) => (
              <Badge key={tag} tone="neutral" glyph={false}>
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      <section>
        <SectionHeader title="Host" subtitle={`${formatCount(stream.hosts.length)} registered.`} />
        {stream.hosts.length === 0 ? (
          <EmptyState
            title="No hosts registered"
            description="A stream always has at least a HOST once created — this one may not have finished setup."
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Identity</TH>
                    <TH>Role</TH>
                    <TH>Invited</TH>
                  </THead>
                  <TBody>
                    {stream.hosts.map((host) => (
                      <TR key={host.identity}>
                        <TD>
                          <span className="font-mono text-sm text-fg">{host.identity}</span>
                        </TD>
                        <TD>
                          <Badge tone={host.role === 'HOST' ? 'accent' : 'info'}>
                            {host.role.replace('_', '-').toLowerCase()}
                          </Badge>
                        </TD>
                        <TD>
                          <span className="tabular text-xs text-muted">{formatDateTime(host.invitedAt)}</span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>
            <div className="sm:hidden">
              <MobileList>
                {stream.hosts.map((host) => (
                  <MobileRow key={host.identity}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs text-fg">{host.identity}</span>
                      <Badge tone={host.role === 'HOST' ? 'accent' : 'info'}>
                        {host.role.replace('_', '-').toLowerCase()}
                      </Badge>
                    </div>
                    <MobileField label="Invited">{formatDateTime(host.invitedAt)}</MobileField>
                  </MobileRow>
                ))}
              </MobileList>
            </div>
          </>
        )}
      </section>

      <section>
        <SectionHeader
          title="Viewers"
          subtitle="Current is read from the SFU each time this refreshes; peak is a stored high-water mark."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="text-xs font-medium text-muted">Current</div>
            <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-fg">
              {stream.viewerCount === null ? <NoDataYet label="SFU unreachable" /> : formatCount(stream.viewerCount)}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="text-xs font-medium text-muted">Peak</div>
            <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-fg">
              {formatCount(stream.peakViewerCount)}
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Chat"
          subtitle={`Metadata only — id, sender, timing, status. Up to the most recent ${MESSAGE_SCAN_LIMIT}.`}
          action={
            stream.conversationId ? (
              <a
                href={`/dashboard/projects/${projectId}/chat/conversations/${stream.conversationId}`}
                className="text-xs font-medium text-accent-text hover:underline"
              >
                Open conversation
              </a>
            ) : undefined
          }
        />
        <ChatActivity conversationId={stream.conversationId} messages={messages} />
      </section>

      <section>
        <SectionHeader
          title="Reactions"
          subtitle="Every viewer reaction attaches to one chat message — the count on it is the stream's total."
        />
        {!stream.conversationId ? (
          <EmptyState
            title="No chat attached"
            description="This stream has no chat conversation, so reactions are unavailable."
          />
        ) : !messages ? (
          <Card>
            <NoDataYet label="Message records are unavailable right now" />
          </Card>
        ) : rootMessage ? (
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Total reactions</span>
              <span className="tabular text-2xl font-semibold text-fg">{formatCount(rootMessage.reactionCount)}</span>
            </div>
          </Card>
        ) : (
          <Card>
            <NoDataYet label={`Not in the ${MESSAGE_SCAN_LIMIT} most recently scanned messages`} />
          </Card>
        )}
      </section>

      <section>
        <SectionHeader title="Timeline" />
        <Card>
          <ol className="flex flex-col gap-3">
            <TimelineEntry label="Created" at={stream.createdAt} />
            <TimelineEntry label="Scheduled for" at={stream.scheduledAt} />
            <TimelineEntry label="Started" at={stream.startedAt} />
            <TimelineEntry label="Ended" at={stream.endedAt} />
          </ol>
        </Card>
      </section>
    </>
  );
}

function ChatActivity({
  conversationId,
  messages,
}: {
  conversationId: string | null;
  messages: ChatMessageSummary[] | undefined;
}) {
  if (!conversationId) {
    return <EmptyState title="No chat attached" description="This stream has no chat conversation." />;
  }
  if (!messages) {
    return (
      <Card>
        <NoDataYet label="Message records are unavailable right now" />
      </Card>
    );
  }
  if (messages.length === 0) {
    return (
      <EmptyState
        title="No chat activity yet"
        description="Messages sent with @ravenkash/chat appear here as soon as they are stored."
      />
    );
  }

  return (
    <>
      <div className="hidden sm:block">
        <TableWrap>
          <Table>
            <THead>
              <TH>Message ID</TH>
              <TH>Sender</TH>
              <TH>Type</TH>
              <TH align="right">Reactions</TH>
              <TH>Sent</TH>
            </THead>
            <TBody>
              {messages.slice(0, 20).map((message) => (
                <TR key={message.id}>
                  <TD>
                    <MonoId value={message.id} />
                  </TD>
                  <TD>
                    <span className="font-mono text-xs text-muted">{message.senderId}</span>
                  </TD>
                  <TD>
                    <span className="text-xs text-muted">{message.type.toLowerCase()}</span>
                  </TD>
                  <TD align="right">
                    <span className="tabular text-muted">{formatCount(message.reactionCount)}</span>
                  </TD>
                  <TD>
                    <span className="tabular text-xs text-muted">{formatDateTime(message.createdAt)}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </div>
      <div className="sm:hidden">
        <MobileList>
          {messages.slice(0, 20).map((message) => (
            <MobileRow key={message.id}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-xs text-fg">{message.senderId}</span>
                <span className="text-xs text-muted">{message.type.toLowerCase()}</span>
              </div>
              <MobileField label="Sent">{formatDateTime(message.createdAt)}</MobileField>
            </MobileRow>
          ))}
        </MobileList>
      </div>
      {messages.length > 20 && (
        <p className="mt-2 text-xs text-subtle">
          Showing the 20 most recent of {formatCount(messages.length)} scanned.
        </p>
      )}
    </>
  );
}

function TimelineEntry({ label, at }: { label: string; at: string | null }) {
  return (
    <li className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      {at ? <span className="tabular text-fg">{formatDateTime(at)}</span> : <Dash />}
    </li>
  );
}
