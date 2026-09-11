import { ChatMember, Conversation } from '../../../generated/prisma/client';

/**
 * The conversation and membership equivalent of `message.serializer.ts`, and
 * it exists for the same reason: internal uuids must not leave the API
 * (spec §57).
 *
 * Messages already went through a serializer; conversations and members did
 * not, and the controllers returned Prisma rows straight from the ORM. So
 * `GET /v1/chat/conversations/:room` handed any browser holding a chat token
 * the conversation's `id` and the project's `projectId`, and
 * `GET .../members` handed out a membership row id and the internal
 * `conversationId` besides. Nothing downstream *needed* those, which is
 * exactly what made it easy to miss: the leak cost nothing and bought
 * nothing.
 *
 * `publicId` keeps its name. Renaming it to `id` would read more
 * consistently with the message serializer, but every existing consumer —
 * `raven-sdk`'s `ChatConversation`, `@ravenkash/server`, the docs, anyone's
 * application code — reads `publicId` today, and breaking all of them buys
 * no security: the leak is the *presence* of the internal uuid, not the
 * spelling of the public one. So `id` is emitted alongside it as the same
 * public value, matching the message serializer for anyone writing new
 * code, and the uuid simply stops being sent.
 */
export interface ChatConversationView {
  /** The public `conv_...` id. Same value as `publicId`. */
  id: string;
  /** The public `conv_...` id, under the name every existing consumer uses. */
  publicId: string;
  name: string;
  type: Conversation['type'];
  status: Conversation['status'];
  environment: Conversation['environment'];
  /**
   * The attached RTC room's name, or null when this is a plain channel.
   *
   * The *name* and not `Room.id`: a room's name is what `@ravenkash/rtc`
   * takes and what the `room.created` webhook already reports, so the two
   * planes name the same room the same way. `Room.id` is a uuid the RTC
   * plane never exposes either.
   */
  rtcRoomName: string | null;
  retentionDays: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMemberView {
  /** Which conversation this membership is in, as its public id. */
  conversationId: string;
  userId: string;
  role: ChatMember['role'];
  status: ChatMember['status'];
  metadata: Record<string, unknown> | null;
  joinedAt: string;
  leftAt: string | null;
}

export function toConversationView(
  conversation: Conversation & { room?: { name: string } | null },
): ChatConversationView {
  return {
    id: conversation.publicId,
    publicId: conversation.publicId,
    name: conversation.name,
    type: conversation.type,
    status: conversation.status,
    environment: conversation.environment,
    rtcRoomName: conversation.room?.name ?? null,
    retentionDays: conversation.retentionDays,
    metadata: (conversation.metadata as Record<string, unknown> | null) ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function toMemberView(member: ChatMember, conversationPublicId: string): ChatMemberView {
  return {
    conversationId: conversationPublicId,
    userId: member.userId,
    role: member.role,
    status: member.status,
    metadata: (member.metadata as Record<string, unknown> | null) ?? null,
    joinedAt: member.joinedAt.toISOString(),
    leftAt: member.leftAt?.toISOString() ?? null,
  };
}
