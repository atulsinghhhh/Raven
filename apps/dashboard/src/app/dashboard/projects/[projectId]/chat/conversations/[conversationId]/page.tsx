import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import type { ChatMemberRole, ChatMessageSummary } from '@/lib/api-client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardHeader, SectionHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { KeyValue, KeyValueGrid, MonoId } from '@/components/ui/mono';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';

const MESSAGE_SCAN_LIMIT = 100;

const MEMBER_ROLE_TONE: Record<ChatMemberRole, BadgeTone> = {
  OWNER: 'accent',
  ADMIN: 'info',
  MEMBER: 'neutral',
};

const MESSAGE_STATUS_TONE: Record<ChatMessageSummary['status'], BadgeTone> = {
  sent: 'neutral',
  edited: 'info',
  deleted: 'danger',
};

/**
 * One conversation: metadata, members, and message *metadata*. There is
 * by design no way to read a message's text from this page: the API
 * behind it never selects `content` in the first place (spec §50), so
 * the restriction can't be undone by a future UI change here without
 * also changing the query that has to name the field explicitly.
 */
export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; conversationId: string }>;
  searchParams: Promise<{ senderId?: string; before?: string; after?: string }>;
}) {
  const { projectId, conversationId } = await params;
  const filters = await searchParams;
  const senderId = filters.senderId?.trim() || undefined;
  const before = filters.before?.trim() || undefined;
  const after = filters.after?.trim() || undefined;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  const [conversationResult, membersResult, messagesResult] = await Promise.allSettled([
    ravenApi.getChatConversation(token, projectId, conversationId),
    ravenApi.listChatConversationMembers(token, projectId, conversationId),
    ravenApi.listChatConversationMessages(token, projectId, conversationId, {
      senderId,
      before,
      after,
      limit: MESSAGE_SCAN_LIMIT,
    }),
  ]);

  if (conversationResult.status === 'rejected') {
    const reason = conversationResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    if (reason instanceof ApiError && reason.status === 404) {
      return (
        <EmptyState
          title="Conversation not found"
          description="This conversation may have been deleted, or it belongs to a different project."
          action={
            <ButtonLink href={`${base}/chat/conversations`} variant="primary">
              All conversations
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this conversation"
        description="The Control API is unreachable right now."
        requestId={reason instanceof ApiError ? reason.code : undefined}
        retryHref={`${base}/chat/conversations/${conversationId}`}
      />
    );
  }

  const conversation = conversationResult.value;
  const members = membersResult.status === 'fulfilled' ? membersResult.value : undefined;
  const messages = messagesResult.status === 'fulfilled' ? messagesResult.value : undefined;
  const hasFilters = Boolean(senderId || before || after);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={conversation.name}
        breadcrumb={{ label: 'All conversations', href: `${base}/chat/conversations` }}
        description="Metadata and message activity. Message contents are never shown here — the API this page reads from doesn't return them."
        meta={
          <Badge tone={conversation.status === 'ACTIVE' ? 'success' : 'neutral'}>
            {conversation.status.toLowerCase()}
          </Badge>
        }
      />

      <Card>
        <CardHeader title="Conversation" />
        <KeyValueGrid>
          <KeyValue label="ID">
            <MonoId value={conversation.id} copy />
          </KeyValue>
          <KeyValue label="Type">
            <Badge tone={conversation.type === 'ROOM' ? 'accent' : 'neutral'}>
              {conversation.type === 'ROOM' ? 'RTC room' : conversation.type.toLowerCase()}
            </Badge>
          </KeyValue>
          <KeyValue label="Linked RTC room">
            {conversation.roomId ? (
              <a href={`${base}/rooms/${conversation.roomId}`} className="text-accent-text hover:underline">
                Open room
              </a>
            ) : (
              <Dash />
            )}
          </KeyValue>
          <KeyValue label="Retention">
            {conversation.retentionDays ? `${conversation.retentionDays} days` : 'Project default'}
          </KeyValue>
          <KeyValue label="Messages">
            <span className="tabular">{formatCount(conversation.messageCount)}</span>
          </KeyValue>
          <KeyValue label="Members">
            <span className="tabular">{formatCount(conversation.memberCount)}</span>
          </KeyValue>
          <KeyValue label="Created">
            <span className="tabular">{formatDateTime(conversation.createdAt)}</span>
          </KeyValue>
          <KeyValue label="Last activity">
            {conversation.lastMessageAt ? (
              <span className="tabular">{formatDateTime(conversation.lastMessageAt)}</span>
            ) : (
              <Dash />
            )}
          </KeyValue>
        </KeyValueGrid>
        {conversation.metadata && Object.keys(conversation.metadata).length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-xs font-medium text-muted">
              Metadata — set by your backend when this conversation was created.
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface-sunken p-3 text-xs text-fg">
              {JSON.stringify(conversation.metadata, null, 2)}
            </pre>
          </div>
        )}
      </Card>

      <section>
        <SectionHeader
          title="Members"
          subtitle={members ? `${formatCount(members.length)} in this conversation.` : undefined}
        />
        {!members ? (
          <Card>
            <NoDataYet label="Member records are unavailable right now" />
          </Card>
        ) : members.length === 0 ? (
          <EmptyState title="No members" description="Nobody has been added to this conversation yet." />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>User</TH>
                    <TH>Role</TH>
                    <TH>Status</TH>
                    <TH>Joined</TH>
                    <TH>Left</TH>
                  </THead>
                  <TBody>
                    {members.map((member) => (
                      <TR key={member.userId}>
                        <TD>
                          <span className="font-mono text-sm text-fg">{member.userId}</span>
                        </TD>
                        <TD>
                          <Badge tone={MEMBER_ROLE_TONE[member.role]}>{member.role.toLowerCase()}</Badge>
                        </TD>
                        <TD>
                          <Badge tone={member.status === 'ACTIVE' ? 'success' : 'neutral'}>
                            {member.status.toLowerCase()}
                          </Badge>
                        </TD>
                        <TD>
                          <span className="tabular text-xs text-muted">{formatRelative(member.joinedAt)}</span>
                        </TD>
                        <TD>
                          {member.leftAt ? (
                            <span className="tabular text-xs text-muted">{formatRelative(member.leftAt)}</span>
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
                {members.map((member) => (
                  <MobileRow key={member.userId}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs text-fg">{member.userId}</span>
                      <Badge tone={MEMBER_ROLE_TONE[member.role]}>{member.role.toLowerCase()}</Badge>
                    </div>
                    <MobileField label="Status">
                      <Badge tone={member.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {member.status.toLowerCase()}
                      </Badge>
                    </MobileField>
                    <MobileField label="Joined">{formatRelative(member.joinedAt)}</MobileField>
                  </MobileRow>
                ))}
              </MobileList>
            </div>
          </>
        )}
      </section>

      <section>
        <SectionHeader
          title="Messages"
          subtitle={`Metadata only — id, sender, timing, status. Up to the most recent ${MESSAGE_SCAN_LIMIT}.`}
        />

        {/* Plain GET form — filters work with JavaScript disabled and the
            resulting URL is shareable/bookmarkable. */}
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
          <Field
            label="Sender ID"
            id="senderId"
            name="senderId"
            defaultValue={senderId}
            placeholder="user_123"
            className="w-48"
          />
          <Field
            label="After"
            id="after"
            name="after"
            type="datetime-local"
            defaultValue={toLocalInput(after)}
            className="w-56"
          />
          <Field
            label="Before"
            id="before"
            name="before"
            type="datetime-local"
            defaultValue={toLocalInput(before)}
            className="w-56"
          />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {hasFilters && (
            <ButtonLink href={`${base}/chat/conversations/${conversationId}`} variant="ghost">
              Clear
            </ButtonLink>
          )}
        </form>

        {!messages ? (
          <Card>
            <NoDataYet label="Message records are unavailable right now" />
          </Card>
        ) : messages.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No messages match these filters' : 'No messages yet'}
            description={
              hasFilters
                ? 'Try a wider date range or clear the sender filter.'
                : 'Messages sent with @ravenkash/chat appear here as soon as they are stored.'
            }
            action={
              hasFilters ? (
                <ButtonLink href={`${base}/chat/conversations/${conversationId}`} variant="secondary">
                  Clear filters
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Message ID</TH>
                    <TH>Sender</TH>
                    <TH>Type</TH>
                    <TH>Status</TH>
                    <TH align="right">Reactions</TH>
                    <TH align="right">Attachments</TH>
                    <TH>Sent</TH>
                  </THead>
                  <TBody>
                    {messages.map((message) => (
                      <TR key={message.id}>
                        <TD>
                          <MonoId value={message.id} />
                          {message.threadRootId && (
                            <span className="ml-1.5 text-[0.6875rem] text-subtle">in thread</span>
                          )}
                        </TD>
                        <TD>
                          <a
                            href={`${base}/chat/conversations/${conversationId}?senderId=${encodeURIComponent(message.senderId)}`}
                            className="font-mono text-xs text-muted hover:text-accent-text hover:underline"
                          >
                            {message.senderId}
                          </a>
                        </TD>
                        <TD>
                          <span className="text-xs text-muted">{message.type.toLowerCase()}</span>
                        </TD>
                        <TD>
                          <Badge tone={MESSAGE_STATUS_TONE[message.status]}>{message.status}</Badge>
                        </TD>
                        <TD align="right">
                          <span className="tabular text-muted">{formatCount(message.reactionCount)}</span>
                        </TD>
                        <TD align="right">
                          <span className="tabular text-muted">{formatCount(message.attachmentCount)}</span>
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
                {messages.map((message) => (
                  <MobileRow key={message.id}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs text-fg">{message.id}</span>
                      <Badge tone={MESSAGE_STATUS_TONE[message.status]}>{message.status}</Badge>
                    </div>
                    <MobileField label="Sender">{message.senderId}</MobileField>
                    <MobileField label="Sent">{formatRelative(message.createdAt)}</MobileField>
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

/** ISO string → the local `datetime-local` input format, so a round-tripped filter doesn't visibly change on reload. */
function toLocalInput(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
