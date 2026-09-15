import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/api-client';
import { getChatConversation } from '@/lib/super-admin/chat';
import { PageHeader } from '@/components/ui/page-header';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Dash, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount, formatDateTime } from '@/lib/format';

const STATUS_TONE: Record<'ACTIVE' | 'ARCHIVED', BadgeTone> = {
  ACTIVE: 'success',
  ARCHIVED: 'neutral',
};

const MEMBER_STATUS_TONE: Record<'ACTIVE' | 'LEFT', BadgeTone> = {
  ACTIVE: 'success',
  LEFT: 'neutral',
};

/**
 * The permission-restricted "deeper inspection" view (spec §11): the API
 * route behind this page (`GET /v1/super-admin/chat/conversations/:id`) is
 * gated to SUPER_ADMIN/ADMIN and writes an AdminAuditLog entry on every
 * read, because this is the one place in the console that names individual
 * member user ids for a specific conversation.
 *
 * There is no message list on this page, on purpose — not a missing
 * feature. `Message.content` is never selected by the API this reads from,
 * so there is nothing to show even if a list were added; only counts,
 * timestamps, and the member roster.
 */
export default async function SuperAdminChatConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = await getSessionToken();
  if (!token) redirect(`/login?next=/super-admin/chat/conversations/${id}`);

  let conversation;
  try {
    conversation = await getChatConversation(token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/super-admin/chat');
    if (error instanceof ApiError && error.status === 403) {
      return (
        <ErrorState
          title="Not permitted"
          description="Inspecting a single conversation's member roster requires the Admin or Super Admin platform role. Your role can see the aggregate chat overview and conversation list, but not this page."
          requestId={error.code}
          retryHref="/super-admin/chat"
        />
      );
    }
    if (error instanceof ApiError && error.status === 404) {
      return (
        <ErrorState
          title="Conversation not found"
          description="It may have been deleted, or the id in the URL is wrong."
          retryHref="/super-admin/chat"
        />
      );
    }
    return (
      <ErrorState
        title="Unable to load this conversation"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`/super-admin/chat/conversations/${id}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={{ label: 'Chat', href: '/super-admin/chat' }}
        title={conversation.name}
        eyebrow={conversation.projectName}
        description="Metadata and member roster only. Message content is never shown here."
        meta={<Badge tone={STATUS_TONE[conversation.status]}>{conversation.status}</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Messages" value={formatCount(conversation.messageCount)} />
        <StatCard label="Members" value={formatCount(conversation.memberCount)} />
        <StatCard label="Type" value={conversation.type} />
        <StatCard
          label="Retention"
          value={conversation.retentionDays === null ? <Dash /> : `${conversation.retentionDays}d`}
        />
      </div>

      <section>
        <SectionHeader title="Details" />
        <Card>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Conversation id</dt>
              <dd className="mt-1 font-mono text-xs text-fg">{conversation.id}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Project</dt>
              <dd className="mt-1 text-sm text-fg">{conversation.projectName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Created</dt>
              <dd className="mt-1 text-sm text-fg">{formatDateTime(conversation.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Last message</dt>
              <dd className="mt-1 text-sm text-fg">
                {conversation.lastMessageAt ? formatDateTime(conversation.lastMessageAt) : <Dash />}
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Members"
          subtitle="Message content is never shown here — only who is in this conversation, and since when."
        />

        {conversation.members.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No members recorded for this conversation.</p>
          </Card>
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>User</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH align="right">Joined</TH>
                  <TH align="right">Left</TH>
                </THead>
                <TBody>
                  {conversation.members.map((member) => (
                    <TR key={member.userId}>
                      <TD className="max-w-[14rem]">
                        <span className="block truncate font-mono text-xs text-fg" title={member.userId}>
                          {member.userId}
                        </span>
                      </TD>
                      <TD className="text-sm text-muted">{member.role}</TD>
                      <TD>
                        <Badge tone={MEMBER_STATUS_TONE[member.status]}>{member.status}</Badge>
                      </TD>
                      <TD align="right" className="tabular text-xs text-subtle">
                        {formatDateTime(member.joinedAt)}
                      </TD>
                      <TD align="right" className="tabular text-xs text-subtle">
                        {member.leftAt ? formatDateTime(member.leftAt) : <Dash />}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="sm:hidden">
              <MobileList>
                {conversation.members.map((member) => (
                  <MobileRow key={member.userId}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs text-fg">{member.userId}</span>
                      <Badge tone={MEMBER_STATUS_TONE[member.status]}>{member.status}</Badge>
                    </div>
                    <div className="mt-3 border-t border-line pt-2">
                      <MobileField label="Role">{member.role}</MobileField>
                      <MobileField label="Joined">{formatDateTime(member.joinedAt)}</MobileField>
                      <MobileField label="Left">{member.leftAt ? formatDateTime(member.leftAt) : ''}</MobileField>
                    </div>
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
