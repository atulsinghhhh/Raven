import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ChatMemberRole } from '../../../generated/prisma/client';
import { AttachmentsService } from '../attachments/attachments.service';
import { CreateAttachmentDto } from '../attachments/dto/create-attachment.dto';
import { ChatActor } from '../auth/chat-actor.interface';
import { ChatAuthGuard } from '../auth/chat-auth.guard';
import { ProjectOriginGuard } from '../../../shared/origins/project-origin.guard';
import { CurrentChatActor } from '../auth/decorators/current-chat-actor.decorator';
import { AddMemberDto } from '../conversations/dto/add-member.dto';
import { CreateConversationDto } from '../conversations/dto/create-conversation.dto';
import { UpdateConversationDto } from '../conversations/dto/update-conversation.dto';
import { ConversationsService } from '../conversations/conversations.service';
import { toConversationView, toMemberView } from '../conversations/conversation.serializer';
import { ListMessagesDto } from '../messages/dto/list-messages.dto';
import { SendMessageDto } from '../messages/dto/send-message.dto';
import { UpdateMessageDto } from '../messages/dto/update-message.dto';
import { MessagesService } from '../messages/messages.service';
import { PresenceService } from '../presence/presence.service';
import { ReactionsService } from '../reactions/reactions.service';
import { ReadStateService } from '../read-state/read-state.service';
import { CreateChatTokenDto } from '../tokens/dto/create-chat-token.dto';
import { ChatTokenService } from '../tokens/chat-token.service';
import { TypingService } from '../typing/typing.service';
import { ChatError } from '../chat-error';
import { ChatErrorCode } from '../chat.constants';

/**
 * The chat REST surface. Every route accepts either credential;
 * a project API key (developer's backend) or a short-lived chat token
 * (browser): resolved by ChatAuthGuard into a ChatActor. One surface,
 * two callers; the actor is what decides who a write is attributed to.
 *
 * Real-time delivery is the WebSocket's job. These endpoints exist for
 * everything a socket is the wrong tool for: minting tokens, managing
 * conversations, and reading history: including the history a client
 * missed while it was disconnected (spec §19).
 */
@ApiTags('Chat')
@ApiBearerAuth('apiKey')
@ApiBearerAuth('chatToken')
@Controller('v1/chat')
// ProjectOriginGuard second, always: it reads the project off the
// credential ChatAuthGuard just verified.
@UseGuards(ChatAuthGuard, ProjectOriginGuard)
export class ChatController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly reactions: ReactionsService,
    private readonly readState: ReadStateService,
    private readonly presence: PresenceService,
    private readonly typing: TypingService,
    private readonly attachments: AttachmentsService,
    private readonly chatTokens: ChatTokenService,
  ) {}

  // ---------------------------------------------------------------------
  // Tokens
  // ---------------------------------------------------------------------

  @Post('tokens')
  @ApiOperation({
    summary: 'Mint a short-lived chat token for one of your users',
    description:
      'Call this from your backend with a project API key, then hand the token to the browser. Never ship an API key to a browser, and never mint a token in one.',
  })
  @ApiResponse({
    status: 201,
    description: 'Token minted',
    schema: {
      example: {
        token: 'eyJhbGciOiJIUzI1NiJ9...',
        tokenId: 'ctk_7Qd2nF...',
        userId: 'user-123',
        scopes: ['chat:read', 'chat:send'],
        chatUrl: 'wss://api.example.com/v1/chat/ws',
        apiUrl: 'https://api.example.com',
        expiresAt: '2026-08-18T13:19:49.233Z',
      },
    },
  })
  async createToken(@CurrentChatActor() actor: ChatActor, @Body() dto: CreateChatTokenDto) {
    // Minting a credential for *someone else* is inherently a server-side
    // act. A browser holding a chat token must not be able to mint a
    // fresh one for a different user, or extend its own lifetime.
    assertServerActor(actor, 'Minting a chat token');

    const conversationIds = await Promise.all(
      (dto.conversations ?? []).map(async (reference) => {
        const conversation = await this.conversations.resolve(actor, reference);
        return conversation.id;
      }),
    );

    const role = await this.conversations.roleFor(conversationIds, dto.userId);

    return this.chatTokens.issue({
      projectId: actor.projectId,
      // Inherited from the API key that minted it. A backend holding a
      // development key cannot hand a browser a production token.
      environment: actor.environment,
      userId: dto.userId,
      conversations: conversationIds,
      role: role ?? ChatMemberRole.MEMBER,
      requestedScopes: dto.scopes,
      ttlSeconds: dto.ttlSeconds,
    });
  }

  @Delete('tokens/:tokenId')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke a minted chat token before it expires',
    description:
      'Refuses the token for any *new* gateway connection, which then fails with TOKEN_REVOKED — an already-open connection is unaffected, since authorization is checked when it opens, not per-frame. Idempotent: revoking an already-revoked, expired, or unrecognized token id succeeds either way, since chat tokens are bearer capabilities with nothing server-side to look up by id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Token revoked',
    schema: { example: { tokenId: 'ctk_7Qd2nF...', revoked: true } },
  })
  async revokeToken(@CurrentChatActor() actor: ChatActor, @Param('tokenId') tokenId: string) {
    // Same reasoning as minting: revoking someone else's credential is a
    // server-side act, not something a browser holding one token should
    // be able to do to another.
    assertServerActor(actor, 'Revoking a chat token');
    await this.chatTokens.revokeByMaxTtl(tokenId);
    return { tokenId, revoked: true };
  }

  // ---------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------

  @Post('conversations')
  @ApiOperation({ summary: 'Create a conversation, optionally attached to an RTC room' })
  async createConversation(@CurrentChatActor() actor: ChatActor, @Body() dto: CreateConversationDto) {
    assertServerActor(actor, 'Creating a conversation');
    return toConversationView(await this.conversations.create(actor, dto));
  }

  @Get('conversations')
  @ApiOperation({ summary: "List the project's conversations" })
  async listConversations(@CurrentChatActor() actor: ChatActor, @Query('includeArchived') includeArchived?: string) {
    assertServerActor(actor, 'Listing every conversation in a project');
    const conversations = await this.conversations.listForProject(actor, includeArchived === 'true');
    return conversations.map((conversation) => toConversationView(conversation));
  }

  @Get('conversations/:room')
  @ApiOperation({ summary: 'Get one conversation by conv_ id, uuid, RTC room id, or name' })
  @ApiNotFoundResponse({ description: 'Conversation not found in this project' })
  async getConversation(@CurrentChatActor() actor: ChatActor, @Param('room') room: string) {
    const { conversation } = await this.conversations.authorize(actor, room);
    return toConversationView(conversation);
  }

  @Patch('conversations/:room')
  @ApiOperation({ summary: 'Rename, archive, or re-configure retention for a conversation' })
  async updateConversation(
    @CurrentChatActor() actor: ChatActor,
    @Param('room') room: string,
    @Body() dto: UpdateConversationDto,
  ) {
    assertServerActor(actor, 'Updating a conversation');
    return toConversationView(await this.conversations.update(actor, room, dto));
  }

  @Post('conversations/:room/members')
  @ApiOperation({ summary: 'Add or re-activate a member' })
  async addMember(@CurrentChatActor() actor: ChatActor, @Param('room') room: string, @Body() dto: AddMemberDto) {
    assertServerActor(actor, 'Adding a member');
    const { conversation } = await this.conversations.authorize(actor, room);
    return toMemberView(await this.conversations.addMember(actor, room, dto), conversation.publicId);
  }

  @Get('conversations/:room/members')
  @ApiOperation({ summary: 'List active members' })
  async listMembers(@CurrentChatActor() actor: ChatActor, @Param('room') room: string) {
    const { conversation } = await this.conversations.authorize(actor, room);
    const members = await this.conversations.listMembers(conversation.id);
    return members.map((member) => toMemberView(member, conversation.publicId));
  }

  @Delete('conversations/:room/members/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a member (soft — their messages keep a resolvable author)' })
  async removeMember(
    @CurrentChatActor() actor: ChatActor,
    @Param('room') room: string,
    @Param('userId') userId: string,
  ) {
    assertServerActor(actor, 'Removing a member');
    await this.conversations.removeMember(actor, room, userId);
  }

  // ---------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------

  @Get('conversations/:room/messages')
  @ApiOperation({
    summary: 'Message history, newest first, cursor-paginated',
    description:
      'Use `before` to page back through history and `after` to catch up on what arrived while disconnected. Cursors are opaque — pass back exactly what the previous page returned.',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { data: [], nextCursor: 'MjAyNi0wOC0xOFQx...', previousCursor: null, hasMore: false } },
  })
  async listMessages(
    @CurrentChatActor() actor: ChatActor,
    @Param('room') room: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messages.list(actor, room, query);
  }

  @Post('conversations/:room/messages')
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Returns only after the message is durably stored — the id and createdAt in the response are canonical. Pass clientMessageId to make retries idempotent.',
  })
  @ApiTooManyRequestsResponse({ description: 'Per-user send rate limit exceeded' })
  async sendMessage(@CurrentChatActor() actor: ChatActor, @Param('room') room: string, @Body() dto: SendMessageDto) {
    const result = await this.messages.send(actor, room, dto);
    return { ...result.message, deduplicated: result.deduplicated };
  }

  @Get('messages/:messageId')
  @ApiOperation({ summary: 'Get one message' })
  getMessage(@CurrentChatActor() actor: ChatActor, @Param('messageId') messageId: string) {
    return this.messages.get(actor, messageId);
  }

  @Get('messages/:messageId/thread')
  @ApiOperation({ summary: "Every message in this message's thread, oldest first" })
  listThread(@CurrentChatActor() actor: ChatActor, @Param('messageId') messageId: string) {
    return this.messages.listThread(actor, messageId);
  }

  @Patch('messages/:messageId')
  @ApiOperation({ summary: 'Edit a message — sets editedAt and returns edited: true' })
  updateMessage(
    @CurrentChatActor() actor: ChatActor,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messages.update(actor, messageId, dto);
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Soft-delete a message; emits message.deleted' })
  deleteMessage(@CurrentChatActor() actor: ChatActor, @Param('messageId') messageId: string) {
    return this.messages.delete(actor, messageId);
  }

  // ---------------------------------------------------------------------
  // Reactions / read state
  // ---------------------------------------------------------------------

  @Post('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Add a reaction (idempotent per user+emoji)' })
  addReaction(
    @CurrentChatActor() actor: ChatActor,
    @Param('messageId') messageId: string,
    @Body('emoji') emoji: string,
  ) {
    return this.reactions.add(actor, messageId, emoji);
  }

  @Delete('messages/:messageId/reactions/:emoji')
  @ApiOperation({ summary: 'Remove a reaction' })
  removeReaction(
    @CurrentChatActor() actor: ChatActor,
    @Param('messageId') messageId: string,
    @Param('emoji') emoji: string,
  ) {
    return this.reactions.remove(actor, messageId, decodeURIComponent(emoji));
  }

  @Post('messages/:messageId/read')
  @ApiOperation({ summary: 'Mark this message — and everything before it — as read' })
  markRead(@CurrentChatActor() actor: ChatActor, @Param('messageId') messageId: string) {
    return this.readState.markRead(actor, messageId);
  }

  @Get('conversations/:room/read-state')
  @ApiOperation({ summary: 'Your read position and unread count for this conversation' })
  getReadState(@CurrentChatActor() actor: ChatActor, @Param('room') room: string) {
    return this.readState.get(actor, room);
  }

  @Get('conversations/:room/read-receipts')
  @ApiOperation({ summary: 'Every member\'s read position — what a "seen by" row is built from' })
  listReadReceipts(@CurrentChatActor() actor: ChatActor, @Param('room') room: string) {
    return this.readState.listForConversation(actor, room);
  }

  // ---------------------------------------------------------------------
  // Presence / typing (ephemeral, Redis-backed)
  // ---------------------------------------------------------------------

  @Get('conversations/:room/presence')
  @ApiOperation({ summary: 'Who is present right now. Ephemeral — never read from Postgres.' })
  async listPresence(@CurrentChatActor() actor: ChatActor, @Param('room') room: string) {
    const { conversation } = await this.conversations.authorize(actor, room);
    return this.presence.list(actor.projectId, conversation.id);
  }

  @Get('conversations/:room/typing')
  @ApiOperation({ summary: 'Who is typing right now' })
  async listTyping(@CurrentChatActor() actor: ChatActor, @Param('room') room: string) {
    const { conversation } = await this.conversations.authorize(actor, room);
    return { userIds: await this.typing.list(actor.projectId, conversation.id) };
  }

  // ---------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------

  @Post('conversations/:room/attachments')
  @ApiOperation({
    summary: 'Get a signed upload URL',
    description:
      'Upload the bytes straight to object storage with the returned URL, call /complete, then send a message referencing the attachment id. Files never pass through Livqeno or the WebSocket.',
  })
  createAttachment(
    @CurrentChatActor() actor: ChatActor,
    @Param('room') room: string,
    @Body() dto: CreateAttachmentDto,
  ) {
    return this.attachments.createUploadTicket(actor, room, dto);
  }

  @Post('attachments/:attachmentId/complete')
  @ApiOperation({ summary: 'Confirm the upload finished, making the attachment sendable' })
  completeAttachment(@CurrentChatActor() actor: ChatActor, @Param('attachmentId') attachmentId: string) {
    return this.attachments.complete(actor, attachmentId);
  }

  @Get('attachments/:attachmentId/download-url')
  @ApiOperation({ summary: 'Short-lived signed download URL for an attachment you can see' })
  createDownloadUrl(@CurrentChatActor() actor: ChatActor, @Param('attachmentId') attachmentId: string) {
    return this.attachments.createDownloadUrl(actor, attachmentId);
  }
}

/**
 * Guards the routes that configure a project rather than participate in a
 * conversation. A browser token is scoped to one user; letting it create
 * conversations or mint credentials would make that scoping meaningless.
 */
function assertServerActor(actor: ChatActor, action: string): void {
  if (actor.kind !== 'server') {
    throw new ChatError(
      ChatErrorCode.PERMISSION_DENIED,
      `${action} requires a project API key, not a browser chat token`,
    );
  }
}
