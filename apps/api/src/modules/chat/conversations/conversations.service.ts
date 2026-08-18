import { Injectable } from '@nestjs/common';
import {
  ChatMember,
  ChatMemberRole,
  ChatMemberStatus,
  Conversation,
  ConversationStatus,
  ConversationType,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ConflictError } from '../../../shared/errors/app-error';
import { generateId } from '../../../shared/utils/crypto.util';
import { toJsonInput } from '../json.util';
import { ChatActor } from '../auth/chat-actor.interface';
import { ChatError } from '../chat-error';
import { ChatErrorCode } from '../chat.constants';
import { ChatScope, scopesForRole } from '../chat-permissions';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { AddMemberDto } from './dto/add-member.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A conversation plus the calling actor's effective rights inside it. */
export interface AuthorizedConversation {
  conversation: Conversation;
  member: ChatMember | null;
  /** Role scopes ∩ token scopes. This — not the token alone — is what services check. */
  scopes: ChatScope[];
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, dto: CreateConversationDto): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: { projectId_name: { projectId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictError(`A conversation named "${dto.name}" already exists in this project`);
    }

    if (dto.roomId) {
      // Same cross-project check as everywhere else: holding a room id
      // from another project must not be enough to attach chat to it.
      const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
      if (!room || room.projectId !== projectId) {
        throw new ChatError(ChatErrorCode.ROOM_NOT_FOUND, 'RTC room not found in this project');
      }
      const alreadyLinked = await this.prisma.conversation.findUnique({ where: { roomId: dto.roomId } });
      if (alreadyLinked) {
        throw new ConflictError(`RTC room "${room.name}" already has a conversation attached`);
      }
    }

    return this.prisma.conversation.create({
      data: {
        publicId: generateId('conv'),
        projectId,
        name: dto.name,
        type: dto.roomId ? ConversationType.ROOM : (dto.type ?? ConversationType.CHANNEL),
        roomId: dto.roomId,
        retentionDays: dto.retentionDays,
        metadata: toJsonInput(dto.metadata),
        members: dto.members?.length
          ? {
              create: dto.members.map((m) => ({
                projectId,
                userId: m.userId,
                role: m.role ?? ChatMemberRole.MEMBER,
              })),
            }
          : undefined,
      },
    });
  }

  listForProject(projectId: string, includeArchived = false): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: { projectId, ...(includeArchived ? {} : { status: ConversationStatus.ACTIVE }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async update(projectId: string, reference: string, dto: UpdateConversationDto): Promise<Conversation> {
    const conversation = await this.resolve(projectId, reference);
    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        name: dto.name,
        status: dto.status,
        retentionDays: dto.retentionDays,
        metadata: toJsonInput(dto.metadata),
      },
    });
  }

  /**
   * Resolves whatever a developer typed into a conversation row. Accepts,
   * in order: a `conv_...` public id, a conversation/RTC-room uuid, or a
   * conversation name. That's why `chat.connect({ room: "support" })` and
   * `chat.connect({ room: "conv_ab12..." })` both work — the SDK doesn't
   * have to know which one it was handed.
   */
  async resolve(projectId: string, reference: string): Promise<Conversation> {
    if (!reference || typeof reference !== 'string') {
      throw new ChatError(ChatErrorCode.ROOM_NOT_FOUND, 'A room/conversation reference is required');
    }

    let conversation: Conversation | null = null;

    if (reference.startsWith('conv_')) {
      conversation = await this.prisma.conversation.findUnique({ where: { publicId: reference } });
    } else if (UUID_PATTERN.test(reference)) {
      conversation =
        (await this.prisma.conversation.findUnique({ where: { id: reference } })) ??
        (await this.prisma.conversation.findUnique({ where: { roomId: reference } }));
    } else {
      conversation = await this.prisma.conversation.findUnique({
        where: { projectId_name: { projectId, name: reference } },
      });
    }

    // Cross-project lookups get the same "not found" as a genuinely
    // missing row — never a 403 that confirms the id exists elsewhere.
    if (!conversation || conversation.projectId !== projectId) {
      throw new ChatError(ChatErrorCode.ROOM_NOT_FOUND, `Conversation "${reference}" not found`);
    }
    return conversation;
  }

  /**
   * The single authorization chokepoint for every chat operation. Resolves
   * the conversation, checks the actor is allowed in it, and returns the
   * intersection of what their role permits with what their token asked
   * for. Services call this instead of trusting a request body.
   */
  async authorize(actor: ChatActor, reference: string): Promise<AuthorizedConversation> {
    const conversation = await this.resolve(actor.projectId, reference);

    // A client token pinned to specific conversations can't wander into
    // others, even ones the user is legitimately a member of.
    if (
      actor.kind === 'client' &&
      actor.conversationScope?.length &&
      !actor.conversationScope.includes(conversation.id) &&
      !actor.conversationScope.includes(conversation.publicId)
    ) {
      throw new ChatError(
        ChatErrorCode.PERMISSION_DENIED,
        'This chat token is not scoped to that conversation',
      );
    }

    // A server actor holds the project's API key: it is already trusted
    // for the whole project and doesn't need a membership row.
    if (actor.kind === 'server') {
      const member = actor.userId
        ? await this.prisma.chatMember.findUnique({
            where: { conversationId_userId: { conversationId: conversation.id, userId: actor.userId } },
          })
        : null;
      return { conversation, member, scopes: actor.scopes };
    }

    const member = await this.prisma.chatMember.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId: actor.userId! } },
    });

    if (!member || member.status === ChatMemberStatus.LEFT) {
      throw new ChatError(
        ChatErrorCode.NOT_A_MEMBER,
        'You are not a member of this conversation',
      );
    }

    const roleScopes = scopesForRole(member.role);
    return { conversation, member, scopes: roleScopes.filter((s) => actor.scopes.includes(s)) };
  }

  /** Writes need an ACTIVE conversation; reads of an archived one stay allowed. */
  assertWritable(conversation: Conversation): void {
    if (conversation.status !== ConversationStatus.ACTIVE) {
      throw new ChatError(ChatErrorCode.CONVERSATION_ARCHIVED, 'This conversation is archived');
    }
  }

  async addMember(projectId: string, reference: string, dto: AddMemberDto): Promise<ChatMember> {
    const conversation = await this.resolve(projectId, reference);
    return this.prisma.chatMember.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: dto.userId } },
      create: {
        conversationId: conversation.id,
        projectId,
        userId: dto.userId,
        role: dto.role ?? ChatMemberRole.MEMBER,
        metadata: toJsonInput(dto.metadata),
      },
      // Re-adding someone who left reactivates the same row rather than
      // orphaning their history behind a second membership.
      update: {
        role: dto.role ?? ChatMemberRole.MEMBER,
        status: ChatMemberStatus.ACTIVE,
        leftAt: null,
        metadata: toJsonInput(dto.metadata),
      },
    });
  }

  async removeMember(projectId: string, reference: string, userId: string): Promise<void> {
    const conversation = await this.resolve(projectId, reference);
    const member = await this.prisma.chatMember.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
    });
    if (!member) {
      throw new ChatError(ChatErrorCode.NOT_A_MEMBER, 'That user is not a member of this conversation');
    }
    // Soft removal — their messages keep a resolvable author.
    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { status: ChatMemberStatus.LEFT, leftAt: new Date() },
    });
  }

  listMembers(conversationId: string): Promise<ChatMember[]> {
    return this.prisma.chatMember.findMany({
      where: { conversationId, status: ChatMemberStatus.ACTIVE },
      orderBy: { joinedAt: 'asc' },
      take: 500,
    });
  }

  /**
   * The role a user holds, for token minting. Non-members get MEMBER so a
   * developer's backend can mint a token and add the membership in either
   * order — the membership check still happens at connect time.
   */
  async roleFor(conversationIds: string[], userId: string): Promise<ChatMemberRole> {
    if (conversationIds.length === 0) {
      return ChatMemberRole.MEMBER;
    }
    const members = await this.prisma.chatMember.findMany({
      where: { conversationId: { in: conversationIds }, userId, status: ChatMemberStatus.ACTIVE },
      select: { role: true },
    });
    if (members.some((m) => m.role === ChatMemberRole.ADMIN)) return ChatMemberRole.ADMIN;
    if (members.some((m) => m.role === ChatMemberRole.MODERATOR)) return ChatMemberRole.MODERATOR;
    return ChatMemberRole.MEMBER;
  }
}
