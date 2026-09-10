import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { chatTabs, ProductTabs } from '@/components/shell/product-tabs';
import { RangeSelector } from '@/components/ui/range-selector';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { IconChat } from '@/components/ui/icons';
import { formatCount } from '@/lib/format';
import { RANGES, type Range } from '@/lib/format';

/**
 * Chat activity for a project. Every number here comes from a real
 * counter or a real row: an idle project shows zeros and ` `, never a
 * plausible-looking fabrication (the same honesty rule the RTC metrics
 * page follows).
 *
 * Deliberately absent: message contents. This page answers "is chat
 * healthy and being used", not "what did people say" (spec §50).
 */
export default async function ChatOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { projectId } = await params;
  const { range: rawRange } = await searchParams;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const range: Range = (RANGES as readonly string[]).includes(rawRange ?? '') ? (rawRange as Range) : '1h';
  const base = `/dashboard/projects/${projectId}`;

  const [overviewResult, conversationsResult] = await Promise.allSettled([
    ravenApi.getChatOverview(token, projectId, range),
    ravenApi.listChatConversations(token, projectId),
  ]);

  if (overviewResult.status === 'rejected') {
    const reason = overviewResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Unable to load chat metrics"
        description="The Control API is unreachable right now. Messages already sent are safe in Postgres — this page just can't read the counters."
        requestId={reason instanceof ApiError ? reason.code : undefined}
        retryHref={`${base}/chat`}
      />
    );
  }

  const overview = overviewResult.value;
  const conversations = conversationsResult.status === 'fulfilled' ? conversationsResult.value : [];

  if (overview.conversations === 0 && overview.messagesStored === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Chat" description="Real-time messaging for this project." />
        <ProductTabs tabs={chatTabs(base)} active="Overview" />
        <EmptyState
          icon={<IconChat className="size-7" />}
          title="No chat activity yet"
          description="Create a conversation from your backend with @ravenkash/server, mint a chat token for a user, and connect with @ravenkash/chat. Everything on this page fills in from real traffic — nothing is simulated."
          action={
            <>
              <ButtonLink href={`${base}/sdks`} variant="primary">
                View SDKs
              </ButtonLink>
              <ButtonLink href={`${base}/api-keys`} variant="secondary">
                Create an API key
              </ButtonLink>
            </>
          }
        />
      </div>
    );
  }

  const deliveryRatio =
    overview.messagesSent > 0 ? (overview.messagesFannedOut / overview.messagesSent).toFixed(1) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Chat"
        description="Real-time messaging activity. Metadata only — message contents are never shown here."
        actions={<RangeSelector basePath={`${base}/chat`} current={range} />}
      />
      <ProductTabs tabs={chatTabs(base)} active="Overview" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Conversations" value={formatCount(overview.conversations)} hint="Active" />
        <StatCard label="Live connections" value={formatCount(overview.activeConnections)} hint="Open WebSockets" />
        <StatCard label="Messages sent" value={formatCount(overview.messagesSent)} hint={`In the last ${range}`} />
        <StatCard
          label="Messages failed"
          value={formatCount(overview.messagesFailed)}
          tone={overview.messagesFailed > 0 ? 'danger' : 'default'}
          hint={`In the last ${range}`}
        />
      </div>

      <section>
        <SectionHeader
          title="Latency"
          subtitle="Measured on the real message path, off the critical path itself — recording these never delays delivery."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader title="Storage" subtitle="Accepted → durably in Postgres." />
            <p className="text-2xl font-semibold tabular text-fg">
              {overview.latency.persistMs === null ? (
                <NoDataYet label="Nothing measured" />
              ) : (
                `${overview.latency.persistMs} ms`
              )}
            </p>
          </Card>
          <Card>
            <CardHeader title="Fan-out" subtitle="Redis publish → delivered to a connected socket." />
            <p className="text-2xl font-semibold tabular text-fg">
              {overview.latency.fanoutMs === null ? (
                <NoDataYet label="Nothing measured" />
              ) : (
                `${overview.latency.fanoutMs} ms`
              )}
            </p>
          </Card>
          <Card>
            <CardHeader
              title="End to end"
              subtitle="Client send → stored. Spans two clocks, so treat it as indicative, not exact."
            />
            <p className="text-2xl font-semibold tabular text-fg">
              {overview.latency.endToEndMs === null ? (
                <NoDataYet label="Nothing measured" />
              ) : (
                `${overview.latency.endToEndMs} ms`
              )}
            </p>
          </Card>
        </div>
      </section>

      <section>
        <SectionHeader title="Throughput" subtitle={`Counters for the last ${range}.`} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Messages / second"
            value={overview.messagesPerSecond.toFixed(2)}
            hint="Averaged over the window"
          />
          <StatCard
            label="Fan-out deliveries"
            value={formatCount(overview.messagesFannedOut)}
            hint={deliveryRatio ? `${deliveryRatio} recipients per message` : 'No messages yet'}
          />
          <StatCard label="Connections opened" value={formatCount(overview.connectionsOpened)} />
          <StatCard
            label="Rate limited"
            value={formatCount(overview.rateLimited)}
            tone={overview.rateLimited > 0 ? 'warning' : 'default'}
            hint="Requests rejected for exceeding a limit"
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Gateway"
          subtitle="The chat WebSocket instance serving this request. In a multi-instance deployment this is one of several."
        />
        <Card>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Instance</dt>
              <dd className="mt-1 font-mono text-xs text-fg">{overview.gateway.gatewayId}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Sockets held</dt>
              <dd className="mt-1 tabular text-sm text-fg">{formatCount(overview.gateway.activeConnections)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Rooms subscribed</dt>
              <dd className="mt-1 tabular text-sm text-fg">{formatCount(overview.gateway.subscribedRooms)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Redis channels</dt>
              <dd className="mt-1 tabular text-sm text-fg">{formatCount(overview.gateway.subscribedChannels)}</dd>
            </div>
          </dl>
        </Card>
      </section>

      {conversations.length > 0 && (
        <section>
          <SectionHeader
            title="Busiest conversations"
            subtitle="By stored message count."
            action={
              <ButtonLink href={`${base}/chat/conversations`} variant="secondary">
                View all
              </ButtonLink>
            }
          />
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {[...conversations]
                .sort((a, b) => b.messageCount - a.messageCount)
                .slice(0, 5)
                .map((conversation) => (
                  <li key={conversation.id}>
                    <a
                      href={`${base}/chat/conversations/${conversation.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface-raised"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-fg">{conversation.name}</span>
                        <span className="block truncate font-mono text-[0.6875rem] text-subtle">{conversation.id}</span>
                      </span>
                      <span className="shrink-0 tabular text-sm text-muted">
                        {formatCount(conversation.messageCount)} messages
                      </span>
                    </a>
                  </li>
                ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
