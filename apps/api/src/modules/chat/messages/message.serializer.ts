import { Attachment, Conversation, Message, Reaction } from '../../../generated/prisma/client';
import { ChatAttachmentView, ChatMessageView, ChatReactionSummary } from '../realtime/chat-event.interface';

export type MessageWithRelations = Message & {
  reactions?: Reaction[];
  attachments?: Attachment[];
};

/**
 * The one place a database row becomes a public object. Internal uuids
 * (`Message.id`, `Conversation.id`) never appear in the output: only
 * `msg_...` / `conv_...` public ids do, which is what keeps §57's "don't
 * expose internal database IDs" true by construction rather than by
 * everyone remembering.
 *
 * A soft-deleted message keeps its envelope (id, sender, timestamps) but
 * loses its body: clients still need to render a "message deleted"
 * placeholder in the right position, and they must not be able to recover
 * the text from the payload.
 */
export function toMessageView(
  message: MessageWithRelations,
  conversation: Pick<Conversation, 'id' | 'publicId'>,
  options: { replyToPublicId?: string | null; threadRootPublicId?: string | null } = {},
): ChatMessageView {
  const deleted = message.deletedAt !== null;

  return {
    id: message.publicId,
    roomId: conversation.publicId,
    conversationId: conversation.publicId,
    senderId: message.senderId,
    type: message.type.toLowerCase() as ChatMessageView['type'],
    text: deleted ? null : message.content,
    replyTo: options.replyToPublicId ?? null,
    threadRootId: options.threadRootPublicId ?? null,
    clientMessageId: message.clientMessageId,
    metadata: deleted ? null : ((message.metadata as Record<string, unknown> | null) ?? null),
    attachment: deleted ? null : toAttachmentView(message.attachments?.[0]),
    reactions: deleted ? [] : summarizeReactions(message.reactions ?? []),
    edited: message.editedAt !== null,
    deleted,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
  };
}

export function toAttachmentView(attachment?: Attachment | null): ChatAttachmentView | null {
  if (!attachment) {
    return null;
  }
  return {
    id: attachment.publicId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.sizeBytes,
    storageKey: attachment.storageKey,
    status: attachment.status.toLowerCase() as ChatAttachmentView['status'],
  };
}

/**
 * Collapses raw reaction rows into per-emoji counts. Clients want
 * "👍 ×3 (alice, bob, carol)", not three rows they have to group
 * themselves, and doing it here means every transport agrees on the
 * shape.
 */
export function summarizeReactions(reactions: Reaction[]): ChatReactionSummary[] {
  const byEmoji = new Map<string, string[]>();
  for (const reaction of reactions) {
    const users = byEmoji.get(reaction.emoji);
    if (users) {
      users.push(reaction.userId);
    } else {
      byEmoji.set(reaction.emoji, [reaction.userId]);
    }
  }

  return Array.from(byEmoji.entries())
    .map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}
