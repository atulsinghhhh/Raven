import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { IconConversations } from '@/components/ui/icons';
import { formatCount, formatRelative } from '@/lib/format';

/**
 * Conversations with activity metadata. There is deliberately no way to
 * read message contents from here — the API doesn't return them to this
 * surface, so the restriction is structural rather than a UI choice
 * someone could quietly undo (spec §50).
 */
export default async function ChatConversationsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  let conversations;
  try {
    conversations = await ravenApi.listChatConversations(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Unable to load conversations"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`${base}/chat/conversations`}
      />
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Conversations" description="Chat channels in this project." />
        <EmptyState
          icon={<IconConversations className="size-7" />}
          title="No conversations yet"
          description="Conversations are created from your backend — a browser chat token can't create them, by design. Use raven.chat.createConversation() from @raven/server."
          action={
            <ButtonLink href={`${base}/sdks`} variant="primary">
              View SDKs
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const totalMessages = conversations.reduce((sum, conversation) => sum + conversation.messageCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Conversations"
        description={`${formatCount(conversations.length)} conversations, ${formatCount(totalMessages)} stored messages. Message contents are never shown here.`}
      />

      <TableWrap className="hidden sm:block">
        <Table>
          <THead>
            <TH>Conversation</TH>
            <TH>Type</TH>
            <TH>Status</TH>
            <TH align="right">Messages</TH>
            <TH align="right">Members</TH>
            <TH>Retention</TH>
            <TH align="right">Last activity</TH>
          </THead>
          <TBody>
            {conversations.map((conversation) => (
              <TR key={conversation.id} interactive>
                <TD className="max-w-[16rem]">
                  <a
                    href={`${base}/chat/conversations/${conversation.id}`}
                    className="block truncate text-sm font-medium text-fg hover:text-accent-text hover:underline"
                    title={conversation.name}
                  >
                    {conversation.name}
                  </a>
                  <span className="block truncate font-mono text-[0.6875rem] text-subtle">{conversation.id}</span>
                </TD>
                <TD>
                  <Badge tone={conversation.type === 'ROOM' ? 'accent' : 'neutral'}>
                    {conversation.type === 'ROOM' ? 'RTC room' : conversation.type.toLowerCase()}
                  </Badge>
                </TD>
                <TD>
                  <Badge tone={conversation.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {conversation.status.toLowerCase()}
                  </Badge>
                </TD>
                <TD align="right" className="tabular text-sm text-muted">
                  {formatCount(conversation.messageCount)}
                </TD>
                <TD align="right" className="tabular text-sm text-muted">
                  {formatCount(conversation.memberCount)}
                </TD>
                <TD className="text-sm text-muted">
                  {conversation.retentionDays ? `${conversation.retentionDays} days` : 'Project default'}
                </TD>
                <TD align="right" className="tabular text-xs text-subtle">
                  {conversation.lastMessageAt ? (
                    <span title={new Date(conversation.lastMessageAt).toISOString()}>
                      {formatRelative(conversation.lastMessageAt)}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <div className="sm:hidden">
        <MobileList>
          {conversations.map((conversation) => (
            <MobileRow key={conversation.id} href={`${base}/chat/conversations/${conversation.id}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{conversation.name}</span>
                  <span className="block truncate font-mono text-[0.6875rem] text-subtle">{conversation.id}</span>
                </span>
                <Badge tone={conversation.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {conversation.status.toLowerCase()}
                </Badge>
              </div>
              <div className="mt-3 border-t border-line pt-2">
                <MobileField label="Messages">{formatCount(conversation.messageCount)}</MobileField>
                <MobileField label="Members">{formatCount(conversation.memberCount)}</MobileField>
                <MobileField label="Last activity">
                  {conversation.lastMessageAt ? formatRelative(conversation.lastMessageAt) : '—'}
                </MobileField>
              </div>
            </MobileRow>
          ))}
        </MobileList>
      </div>

      <p className="text-xs text-subtle">
        Showing up to the 200 most recent conversations. Retention is enforced per conversation where set, otherwise by
        the deployment&apos;s <code className="font-mono">CHAT_RETENTION_DAYS</code>.
      </p>
    </div>
  );
}
