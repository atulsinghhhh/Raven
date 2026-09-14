import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/api-client';
import { getChatOverview, listChatConversations, type ChatConversationListItem } from '@/lib/super-admin/chat';
import { PageHeader } from '@/components/ui/page-header';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { BarChart } from '@/components/ui/chart';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { IconChat } from '@/components/ui/icons';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';

const PAGE_SIZE = 25;

const STATUS_TONE: Record<ChatConversationListItem['status'], BadgeTone> = {
  ACTIVE: 'success',
  ARCHIVED: 'neutral',
};

/**
 * Chat operations, platform-wide (spec §11) — every conversation across
 * every project, not one developer's own. This is a metrics-and-inventory
 * surface, not a message reader: the API this reads from
 * (`/v1/super-admin/chat/*`) never selects `Message.content`, and this
 * page never renders it either.
 */
export default async function SuperAdminChatPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: rawPage } = await searchParams;
  const page = Math.max(Number.parseInt(rawPage ?? '1', 10) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/chat');

  const [overviewResult, conversationsResult] = await Promise.allSettled([
    getChatOverview(token),
    listChatConversations(token, { limit: PAGE_SIZE, offset }),
  ]);

  if (overviewResult.status === 'rejected') {
    const reason = overviewResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login?next=/super-admin/chat');
    return (
      <ErrorState
        title="Unable to load chat metrics"
        description="The Control API is unreachable right now."
        requestId={reason instanceof ApiError ? reason.code : undefined}
        retryHref="/super-admin/chat"
      />
    );
  }

  const overview = overviewResult.value;
  const conversations = conversationsResult.status === 'fulfilled' ? conversationsResult.value : { items: [], total: 0 };
  const totalPages = Math.max(Math.ceil(conversations.total / PAGE_SIZE), 1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Chat"
        description="Real-time messaging activity across every project. Metadata only — message content is never shown here."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Conversations"
          value={formatCount(overview.conversations.total)}
          hint={`${formatCount(overview.conversations.active)} active`}
        />
        <StatCard label="Messages today" value={formatCount(overview.messages.today)} hint="Stored, not just sent" />
        <StatCard label="Messages this month" value={formatCount(overview.messages.thisMonth)} />
        <StatCard
          label="Failed messages"
          value={formatCount(overview.failedMessages.today)}
          tone={overview.failedMessages.today > 0 ? 'danger' : 'default'}
          hint="Today"
        />
        <StatCard label="Active chat users" value={formatCount(overview.activeChatUsers)} hint="Connected right now" />
        <StatCard
          label="Throughput"
          value={overview.throughput.messagesPerMinuteLastHour.toFixed(2)}
          hint="Messages / minute, last hour"
        />
        <StatCard label="Total messages stored" value={formatCount(overview.messages.total)} />
        <StatCard label="Archived conversations" value={formatCount(overview.conversations.archived)} />
      </div>

      <section>
        <SectionHeader title="Message trends" subtitle="Messages stored per bucket, oldest to newest." />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card>
            <p className="mono-label mb-2 text-[11px] text-muted">Daily · last 14 days</p>
            <BarChart
              caption="Messages per day, last 14 days"
              data={overview.trends.daily.map((point) => ({
                label: shortDate(point.bucketStart),
                value: point.messages,
                hint: `${formatDateTime(point.bucketStart)}: ${formatCount(point.messages)} messages`,
              }))}
            />
          </Card>
          <Card>
            <p className="mono-label mb-2 text-[11px] text-muted">Weekly · last 8 weeks</p>
            <BarChart
              caption="Messages per week, last 8 weeks"
              data={overview.trends.weekly.map((point) => ({
                label: shortDate(point.bucketStart),
                value: point.messages,
                hint: `Week of ${formatDateTime(point.bucketStart)}: ${formatCount(point.messages)} messages`,
              }))}
            />
          </Card>
          <Card>
            <p className="mono-label mb-2 text-[11px] text-muted">Monthly · last 6 months</p>
            <BarChart
              caption="Messages per month, last 6 months"
              data={overview.trends.monthly.map((point) => ({
                label: shortMonth(point.bucketStart),
                value: point.messages,
                hint: `${shortMonth(point.bucketStart)}: ${formatCount(point.messages)} messages`,
              }))}
            />
          </Card>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Conversations"
          subtitle={`${formatCount(conversations.total)} across every project. Page ${page} of ${totalPages}.`}
        />

        {conversations.items.length === 0 ? (
          <EmptyState
            icon={<IconChat className="size-7" />}
            title="No conversations yet"
            description="A row appears here the moment any project creates a chat conversation. Nothing on this page is simulated."
          />
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>Conversation</TH>
                  <TH>Project</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH align="right">Members</TH>
                  <TH align="right">Messages</TH>
                  <TH align="right">Last activity</TH>
                </THead>
                <TBody>
                  {conversations.items.map((conversation) => (
                    <TR key={conversation.id} interactive>
                      <TD className="max-w-[16rem]">
                        <a href={`/super-admin/chat/conversations/${conversation.id}`} className="block min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{conversation.name}</span>
                          <span className="block truncate font-mono text-[0.6875rem] text-subtle">{conversation.id}</span>
                        </a>
                      </TD>
                      <TD className="max-w-[10rem]">
                        <span className="block truncate text-sm text-muted" title={conversation.projectName}>
                          {conversation.projectName}
                        </span>
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-muted">{conversation.type}</span>
                      </TD>
                      <TD>
                        <Badge tone={STATUS_TONE[conversation.status]}>{conversation.status}</Badge>
                      </TD>
                      <TD align="right" className="tabular text-sm text-muted">
                        {formatCount(conversation.memberCount)}
                      </TD>
                      <TD align="right" className="tabular text-sm text-muted">
                        {formatCount(conversation.messageCount)}
                      </TD>
                      <TD align="right" className="tabular text-xs text-subtle">
                        {formatRelative(conversation.lastMessageAt)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="sm:hidden">
              <MobileList>
                {conversations.items.map((conversation) => (
                  <MobileRow key={conversation.id} href={`/super-admin/chat/conversations/${conversation.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-fg">{conversation.name}</span>
                        <span className="block truncate font-mono text-[0.6875rem] text-subtle">{conversation.id}</span>
                      </span>
                      <Badge tone={STATUS_TONE[conversation.status]}>{conversation.status}</Badge>
                    </div>
                    <div className="mt-3 border-t border-line pt-2">
                      <MobileField label="Project">{conversation.projectName}</MobileField>
                      <MobileField label="Type">{conversation.type}</MobileField>
                      <MobileField label="Members">{formatCount(conversation.memberCount)}</MobileField>
                      <MobileField label="Messages">{formatCount(conversation.messageCount)}</MobileField>
                      <MobileField label="Last activity">{formatRelative(conversation.lastMessageAt)}</MobileField>
                    </div>
                  </MobileRow>
                ))}
              </MobileList>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <ButtonLink
                  href={`/super-admin/chat?page=${page - 1}`}
                  variant="secondary"
                  size="sm"
                  aria-disabled={page <= 1}
                  className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
                >
                  Previous
                </ButtonLink>
                <span className="text-xs text-muted">
                  Page {page} of {totalPages}
                </span>
                <ButtonLink
                  href={`/super-admin/chat?page=${page + 1}`}
                  variant="secondary"
                  size="sm"
                  aria-disabled={page >= totalPages}
                  className={page >= totalPages ? 'pointer-events-none opacity-50' : ''}
                >
                  Next
                </ButtonLink>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

function shortMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
}
