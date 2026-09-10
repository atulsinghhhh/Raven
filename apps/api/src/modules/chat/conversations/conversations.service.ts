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
import { ProjectScope } from '../../../shared/environment/environment.constants';
import { WebhookEventsService } from '../../webhooks/webhook-events.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

/** A conversation plus the calling actor's effective rights inside it. */
export interface AuthorizedConversation {
  conversation: Conversation;
  member: ChatMember | null;
  /** Role scopes ∩ token scopes. This, not the token alone, is what services check. */
  scopes: ChatScope[];
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookEventsService,
  ) {}

  async create(scope: ProjectScope, dto: CreateConversationDto): Promise<Conversation> {
    const { projectId, environment } = scope;
    const existing = await this.prisma.conversation.findUnique({
      where: { projectId_environment_name: { projectId, environment, name: dto.name } },
    });
    if (existing) {
      throw new ConflictError(
        `A conversation named "${dto.name}" already exists in this project's ${environment} environment`,
      );
    }

    let linkedRoomName: string | undefined;

    if (dto.roomId) {
      // Same cross-project check as everywhere else: holding a room id
      // from another project must not be enough to attach chat to it.
      const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
      // Environment matters as much as project here: attaching a chat
      // channel to a room from another environment would join the two.
      if (!room || room.projectId !== projectId || room.environment !== environment) {
        throw new ChatError(ChatErrorCode.ROOM_NOT_FOUND, 'RTC room not found in this project');
      }
      const alreadyLinked = await this.prisma.conversation.findUnique({ where: { roomId: dto.roomId } });
      if (alreadyLinked) {
        throw new ConflictError(`RTC room "${room.name}" already has a conversation attached`);
      }
      linkedRoomName = room.name;
    }

    let conversation: Conversation;
    try {
      conversation = await this.prisma.conversation.create({
        data: {
          publicId: generateId('conv'),
          projectId,
          environment,
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
    } catch (err) {
      // The findUnique check above is a plain check-then-act race: two
      // concurrent creates for the same name can both pass it and then
      // both reach here, with the loser hitting the unique constraint
      // directly. Surface the same clean ConflictError the pre-check
      // throws rather than a raw 500.
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          `A conversation named "${dto.name}" already exists in this project's ${environment} environment`,
        );
      }
      throw err;
    }

    // `void`, like every other emit: a developer's webhook endpoint must
    // never be able to fail a conversation that is already stored.
    void this.webhooks.emit(scope, 'room.created', {
      roomId: conversation.publicId,
      name: conversation.name,
      type: conversation.type,
      rtcRoomId: conversation.roomId,
      rtcRoomName: linkedRoomName,
      createdAt: conversation.createdAt.toISOString(),
    });

    return conversation;
  }

  listForProject(scope: ProjectScope, includeArchived = false): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: {
        projectId: scope.projectId,
        environment: scope.environment,
        ...(includeArchived ? {} : { status: ConversationStatus.ACTIVE }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async update(scope: ProjectScope, reference: string, dto: UpdateConversationDto): Promise<Conversation> {
    const conversation = await this.resolve(scope, reference);
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
   * `chat.connect({ room, "conv_ab12..." })` both work: the SDK doesn't
   * have to know which one it was handed.
   */
  async resolve(scope: ProjectScope, reference: string): Promise<Conversation> {
    const { projectId, environment } = scope;
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
        where: { projectId_environment_name: { projectId, environment, name: reference } },
      });
    }

    // Cross-project and cross-environment lookups both get the same
    // "not found" as a genuinely missing row: never a 403 that confirms
    // the id exists somewhere the caller cannot reach.
    if (!conversation || conversation.projectId !== projectId || conversation.environment !== environment) {
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
    const conversation = await this.resolve(actor, reference);

    // A client token pinned to specific conversations can't wander into
    // others, even ones the user is legitimately a member of.
    if (
      actor.kind === 'client' &&
      actor.conversationScope?.length &&
      !actor.conversationScope.includes(conversation.id) &&
      !actor.conversationScope.includes(conversation.publicId)
    ) {
      throw new ChatError(ChatErrorCode.PERMISSION_DENIED, 'This chat token is not scoped to that conversation');
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
      throw new ChatError(ChatErrorCode.NOT_A_MEMBER, 'You are not a member of this conversation');
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

  async addMember(scope: ProjectScope, reference: string, dto: AddMemberDto): Promise<ChatMember> {
    const conversation = await this.resolve(scope, reference);
    const member = await this.prisma.chatMember.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: dto.userId } },
      create: {
        conversationId: conversation.id,
        projectId: scope.projectId,
        userId: dto.userId,
        role: dto.role ?? ChatMemberRole.MEMBER,
        metadata: toJsonInput(dto.metadata),
      },
      // Re-adding someone who left reactivates the same row instead of
      // orphaning their history behind a second membership.
      update: {
        role: dto.role ?? ChatMemberRole.MEMBER,
        status: ChatMemberStatus.ACTIVE,
        leftAt: null,
        metadata: toJsonInput(dto.metadata),
      },
    });

    void this.webhooks.emit(scope, 'participant.joined', {
      roomId: conversation.publicId,
      userId: member.userId,
      role: member.role,
      at: member.joinedAt.toISOString(),
    });

    return member;
  }

  async removeMember(scope: ProjectScope, reference: string, userId: string): Promise<void> {
    const conversation = await this.resolve(scope, reference);
    const member = await this.prisma.chatMember.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
    });
    if (!member) {
      throw new ChatError(ChatErrorCode.NOT_A_MEMBER, 'That user is not a member of this conversation');
    }
    // Soft removal: their messages keep a resolvable author.
    const removed = await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { status: ChatMemberStatus.LEFT, leftAt: new Date() },
    });

    void this.webhooks.emit(scope, 'participant.left', {
      roomId: conversation.publicId,
      userId: removed.userId,
      role: removed.role,
      at: (removed.leftAt ?? new Date()).toISOString(),
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
   * order: the membership check still happens at connect time.
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
