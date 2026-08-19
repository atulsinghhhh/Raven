import { Injectable } from '@nestjs/common';
import {
  ChatMemberRole,
  LiveStream,
  LiveStreamHost,
  LiveStreamHostRole,
  LiveStreamStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { generateId } from '../../shared/utils/crypto.util';
import { ProjectScope } from '../../shared/environment/environment.constants';
import { ChatActor } from '../chat/auth/chat-actor.interface';
import { CHAT_SCOPES } from '../chat/chat-permissions';
import { ConversationsService } from '../chat/conversations/conversations.service';
import { MessagesService } from '../chat/messages/messages.service';
import { ChatTokenService, IssuedChatToken } from '../chat/tokens/chat-token.service';
import { LiveKitRoomService } from '../rooms/livekit-room.service';
import { RoomsService } from '../rooms/rooms.service';
import { IssuedRtcToken, RtcTokensService } from '../rtc-tokens/rtc-tokens.service';
import { WebhookEventsService } from '../webhooks/webhook-events.service';
import { AddHostDto } from './dto/add-host.dto';
import { CreateLiveStreamDto } from './dto/create-live-stream.dto';
import { UpdateLiveStreamDto } from './dto/update-live-stream.dto';
import { toJsonInput } from './json.util';

export interface LiveStreamHostView {
  identity: string;
  role: LiveStreamHostRole;
  invitedAt: string;
}

export interface LiveStreamView {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  tags: string[];
  language: string | null;
  visibility: string;
  metadata: Record<string, unknown> | null;
  status: LiveStreamStatus;
  hosts: LiveStreamHostView[];
  /** Live participants of the underlying room who are not registered hosts. `null` means the SFU could not be reached — distinct from a genuinely empty 0. */
  viewerCount: number | null;
  peakViewerCount: number;
  conversationId: string | null;
  /** The chat message viewer reactions attach to — see docs/live-streaming/overview.md#reactions. */
  chatRootMessageId: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssuedStreamCredential {
  identity: string;
  role: LiveStreamHostRole | 'VIEWER';
  rtc: IssuedRtcToken;
  chat?: IssuedChatToken;
}

/**
 * Live Streaming's entire media/messaging model is reuse: a stream is one
 * RTC Room (host/co-hosts/viewers are ordinary participants of it, given
 * different permission grants by which endpoint minted their token — see
 * createHostCredential/createViewerToken) plus one Chat Conversation
 * (attached exactly the way a video call's chat panel already is). This
 * service owns the lifecycle and role bookkeeping on top of both; it never
 * duplicates what RoomsService, RtcTokensService, ConversationsService, or
 * ChatTokenService already do correctly.
 */
@Injectable()
export class LiveStreamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
    private readonly liveKitRoomService: LiveKitRoomService,
    private readonly rtcTokensService: RtcTokensService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly chatTokenService: ChatTokenService,
    private readonly webhooks: WebhookEventsService,
  ) {}

  async create(scope: ProjectScope, dto: CreateLiveStreamDto): Promise<LiveStreamView> {
    // One generated id is reused as both the Room's and the Conversation's
    // name — a stream never asks the developer to think about either.
    // generateId's alphabet (base64url) is already a subset of the
    // room/conversation name pattern, so no further sanitizing is needed.
    const publicId = generateId('stream');

    const room = await this.roomsService.create(scope, { name: publicId });
    const conversation = await this.conversationsService.create(scope, { name: publicId, roomId: room.id });

    // A system message every viewer reaction attaches to (see toJsonInput
    // note in the class doc) — reuses the existing Reaction model instead
    // of inventing a second realtime primitive for "someone tapped ❤️".
    const systemActor: ChatActor = {
      kind: 'server',
      projectId: scope.projectId,
      environment: scope.environment,
      userId: null,
      scopes: [...CHAT_SCOPES],
    };
    const { message: rootMessage } = await this.messagesService.send(systemActor, conversation.publicId, {
      type: 'system',
      text: `Live stream "${dto.title}" was created`,
      senderId: 'system',
    });

    const stream = await this.prisma.liveStream.create({
      data: {
        publicId,
        projectId: scope.projectId,
        environment: scope.environment,
        roomId: room.id,
        conversationId: conversation.id,
        chatRootMessageId: rootMessage.id,
        title: dto.title,
        description: dto.description,
        thumbnailUrl: dto.thumbnailUrl,
        category: dto.category,
        tags: dto.tags ?? [],
        language: dto.language,
        visibility: dto.visibility,
        metadata: toJsonInput(dto.metadata),
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        hosts: { create: { identity: dto.hostIdentity, role: LiveStreamHostRole.HOST } },
      },
      include: { hosts: true },
    });

    void this.webhooks.emit(scope, 'live_stream.created', {
      streamId: stream.publicId,
      title: stream.title,
      visibility: stream.visibility,
      hostIdentity: dto.hostIdentity,
      createdAt: stream.createdAt.toISOString(),
    });

    return this.toView(stream, stream.hosts, false);
  }

  async get(scope: ProjectScope, streamId: string): Promise<LiveStreamView> {
    const stream = await this.resolveRaw(scope, streamId);
    const hosts = await this.activeHosts(stream.id);
    return this.toView(stream, hosts, true);
  }

  async list(scope: ProjectScope, status?: LiveStreamStatus): Promise<LiveStreamView[]> {
    const streams = await this.prisma.liveStream.findMany({
      where: { projectId: scope.projectId, environment: scope.environment, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Live state (viewer count) is skipped on the list endpoint — one SFU
    // round trip per row would make "list my streams" as slow as the
    // slowest room in it. Fetch a single stream to see its live count.
    return Promise.all(
      streams.map(async (stream) => this.toView(stream, await this.activeHosts(stream.id), false)),
    );
  }

  async update(scope: ProjectScope, streamId: string, dto: UpdateLiveStreamDto): Promise<LiveStreamView> {
    const stream = await this.resolveRaw(scope, streamId);
    this.assertNotEnded(stream);

    const updated = await this.prisma.liveStream.update({
      where: { id: stream.id },
      data: {
        title: dto.title,
        description: dto.description,
        thumbnailUrl: dto.thumbnailUrl,
        category: dto.category,
        tags: dto.tags,
        language: dto.language,
        visibility: dto.visibility,
        metadata: toJsonInput(dto.metadata),
      },
    });

    return this.toView(updated, await this.activeHosts(updated.id), false);
  }

  /**
   * CREATED → LIVE. There is no separate call for the STARTING state:
   * nothing in this implementation has an async provisioning step to
   * represent (no recording/transcoding setup exists yet), so start()
   * both validates the transition and completes it in one request rather
   * than making the developer poll a STARTING status that is honestly
   * never observable. Rejects a repeat call rather than treating it as a
   * no-op — a stream's startedAt must mean "actually started once", not
   * "most recently asked to start".
   */
  async start(scope: ProjectScope, streamId: string): Promise<LiveStreamView> {
    const stream = await this.resolveRaw(scope, streamId);
    if (stream.status !== LiveStreamStatus.CREATED) {
      throw new ConflictError(
        `Cannot start a stream that is ${stream.status} — only a CREATED stream can be started`,
        RavenErrorCode.STREAM_INVALID_STATE,
      );
    }

    const startedAt = new Date();
    const updated = await this.prisma.liveStream.update({
      where: { id: stream.id },
      data: { status: LiveStreamStatus.LIVE, startedAt },
    });

    void this.webhooks.emit(scope, 'live_stream.started', {
      streamId: updated.publicId,
      startedAt: startedAt.toISOString(),
    });

    return this.toView(updated, await this.activeHosts(updated.id), true);
  }

  /**
   * LIVE → ENDED, terminal. Closes the underlying Room too (soft —
   * RoomStatus.CLOSED, same as a developer calling `rooms.close()`
   * directly), so a stream that has ended cannot be rejoined by minting a
   * fresh RTC token against its room. There is no ENDED → LIVE transition
   * — restarting an ended stream would need a real replay/restart model
   * this phase does not implement; create a new stream instead.
   */
  async end(scope: ProjectScope, streamId: string): Promise<LiveStreamView> {
    const stream = await this.resolveRaw(scope, streamId);
    if (stream.status !== LiveStreamStatus.LIVE) {
      throw new ConflictError(
        `Cannot end a stream that is ${stream.status} — only a LIVE stream can be ended`,
        RavenErrorCode.STREAM_INVALID_STATE,
      );
    }

    const endedAt = new Date();
    const updated = await this.prisma.liveStream.update({
      where: { id: stream.id },
      data: { status: LiveStreamStatus.ENDED, endedAt },
    });
    await this.roomsService.close(stream.roomId, scope);

    void this.webhooks.emit(scope, 'live_stream.ended', {
      streamId: updated.publicId,
      endedAt: endedAt.toISOString(),
      durationMs: updated.startedAt ? endedAt.getTime() - updated.startedAt.getTime() : null,
    });

    return this.toView(updated, await this.activeHosts(updated.id), false);
  }

  /**
   * Registers (or re-registers) a host/co-host and mints their credentials
   * in one call — an RTC token with full publish permissions and a chat
   * token with a moderator-or-above role, both scoped to this stream's
   * room/conversation. Never reads a role from anywhere but this
   * endpoint's own DTO: there is no field anywhere a viewer token accepts
   * that could turn it into a host token.
   */
  async addHost(scope: ProjectScope, streamId: string, dto: AddHostDto): Promise<IssuedStreamCredential> {
    const stream = await this.resolveRaw(scope, streamId);
    this.assertNotEnded(stream);

    const role = dto.role ?? LiveStreamHostRole.CO_HOST;
    const host = await this.prisma.liveStreamHost.upsert({
      where: { streamId_identity: { streamId: stream.id, identity: dto.identity } },
      create: { streamId: stream.id, identity: dto.identity, role },
      // Re-inviting someone who was removed reactivates the same row.
      update: { role, removedAt: null },
    });

    const credential = await this.mintCredential(scope, stream, dto.identity, {
      rtcPublish: true,
      chatRole: role === LiveStreamHostRole.HOST ? ChatMemberRole.ADMIN : ChatMemberRole.MODERATOR,
    });

    void this.webhooks.emit(scope, 'live_stream.host_joined', {
      streamId: stream.publicId,
      identity: dto.identity,
      role: host.role,
      at: host.invitedAt.toISOString(),
    });

    return { identity: dto.identity, role: host.role, ...credential };
  }

  async removeHost(scope: ProjectScope, streamId: string, identity: string): Promise<void> {
    const stream = await this.resolveRaw(scope, streamId);
    const host = await this.prisma.liveStreamHost.findUnique({
      where: { streamId_identity: { streamId: stream.id, identity } },
    });
    if (!host || host.removedAt) {
      throw new NotFoundError('Host', RavenErrorCode.NOT_FOUND);
    }

    const removedAt = new Date();
    await this.prisma.liveStreamHost.update({ where: { id: host.id }, data: { removedAt } });

    if (stream.conversationId) {
      const conversation = await this.prisma.conversation.findUnique({ where: { id: stream.conversationId } });
      if (conversation) {
        await this.conversationsService.removeMember(scope, conversation.publicId, identity).catch(() => undefined);
      }
    }

    void this.webhooks.emit(scope, 'live_stream.host_left', {
      streamId: stream.publicId,
      identity,
      at: removedAt.toISOString(),
    });
  }

  /**
   * Mints a viewer's credentials. Always subscribe-only on the RTC side
   * and MEMBER on the chat side, regardless of anything in the request —
   * the only way an identity gets publish access is addHost() above,
   * called by the developer's own backend, never by an untrusted client.
   */
  async createViewerToken(scope: ProjectScope, streamId: string, identity: string): Promise<IssuedStreamCredential> {
    const stream = await this.resolveRaw(scope, streamId);
    this.assertNotEnded(stream);

    const credential = await this.mintCredential(scope, stream, identity, {
      rtcPublish: false,
      chatRole: ChatMemberRole.MEMBER,
    });

    void this.webhooks.emit(scope, 'live_stream.viewer_joined', {
      streamId: stream.publicId,
      identity,
      at: new Date().toISOString(),
    });

    return { identity, role: 'VIEWER', ...credential };
  }

  /**
   * Explicit viewer-leave signal for `live_stream.viewer_left`. This is
   * the one honest limitation worth stating plainly: Raven has no LiveKit
   * webhook receiver in this phase, so an abrupt disconnect (crash, lost
   * network) is not detected server-side for streams — only a clean
   * `stream.leave()` call from the SDK fires this event. Presence-style
   * best-effort detection is real future work, not simulated here.
   */
  async leave(scope: ProjectScope, streamId: string, identity: string): Promise<void> {
    const stream = await this.resolveRaw(scope, streamId);
    void this.webhooks.emit(scope, 'live_stream.viewer_left', {
      streamId: stream.publicId,
      identity,
      at: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async mintCredential(
    scope: ProjectScope,
    stream: LiveStream,
    identity: string,
    opts: { rtcPublish: boolean; chatRole: ChatMemberRole },
  ): Promise<{ rtc: IssuedRtcToken; chat?: IssuedChatToken }> {
    const rtc = await this.rtcTokensService.create(scope, stream.roomId, {
      participantIdentity: identity,
      permissions: {
        join: true,
        subscribe: true,
        publish: opts.rtcPublish,
        publishAudio: opts.rtcPublish,
        publishVideo: opts.rtcPublish,
        publishData: opts.rtcPublish,
      },
    });

    let chat: IssuedChatToken | undefined;
    if (stream.conversationId) {
      const conversation = await this.prisma.conversation.findUnique({ where: { id: stream.conversationId } });
      if (conversation) {
        await this.conversationsService.addMember(scope, conversation.publicId, {
          userId: identity,
          role: opts.chatRole,
        });
        chat = this.chatTokenService.issue({
          projectId: scope.projectId,
          environment: scope.environment,
          userId: identity,
          conversations: [conversation.publicId],
          role: opts.chatRole,
        });
      }
    }

    return { rtc, chat };
  }

  /** Public id (`stream_...`) or internal uuid — same dual-lookup convention as Room/Conversation. */
  private async resolveRaw(scope: ProjectScope, streamId: string): Promise<LiveStream> {
    const stream = streamId.startsWith('stream_')
      ? await this.prisma.liveStream.findUnique({ where: { publicId: streamId } })
      : await this.prisma.liveStream.findUnique({ where: { id: streamId } });

    // Cross-project and cross-environment lookups get the same "not
    // found" as a genuinely missing row — same reasoning as Room/Conversation.
    if (!stream || stream.projectId !== scope.projectId || stream.environment !== scope.environment) {
      throw new NotFoundError('Live stream', RavenErrorCode.STREAM_NOT_FOUND);
    }
    return stream;
  }

  private assertNotEnded(stream: LiveStream): void {
    if (stream.status === LiveStreamStatus.ENDED) {
      throw new ConflictError(
        'This stream has ended and can no longer be modified',
        RavenErrorCode.STREAM_INVALID_STATE,
      );
    }
  }

  private activeHosts(streamId: string): Promise<LiveStreamHost[]> {
    return this.prisma.liveStreamHost.findMany({ where: { streamId, removedAt: null } });
  }

  /**
   * Viewer count is never stored — polled from the SFU on demand, exactly
   * like `RoomsService`'s own live participant count, and for the same
   * reason: a stored count would drift the moment anyone's connection
   * changes without telling Postgres. `withLiveState=false` (list/create/
   * update) skips the SFU round trip entirely.
   */
  private async toView(
    stream: LiveStream,
    hosts: LiveStreamHost[],
    withLiveState: boolean,
  ): Promise<LiveStreamView> {
    let viewerCount: number | null = null;
    let peakViewerCount = stream.peakViewerCount;

    if (withLiveState) {
      const room = await this.prisma.room.findUnique({ where: { id: stream.roomId }, select: { name: true } });
      const liveParticipants = room ? await this.liveKitRoomService.listLiveParticipants(room.name) : undefined;

      if (liveParticipants) {
        const hostIdentities = new Set(hosts.map((h) => h.identity));
        viewerCount = liveParticipants.filter((p) => !hostIdentities.has(p.identity)).length;

        if (viewerCount > peakViewerCount) {
          peakViewerCount = viewerCount;
          // Best-effort high-water mark — a failed write here would only
          // under-report a peak, never corrupt anything, so it's not
          // awaited into the request's success/failure path.
          void this.prisma.liveStream
            .update({ where: { id: stream.id }, data: { peakViewerCount } })
            .catch(() => undefined);
        }
      }
    }

    return {
      id: stream.publicId,
      title: stream.title,
      description: stream.description,
      thumbnailUrl: stream.thumbnailUrl,
      category: stream.category,
      tags: stream.tags,
      language: stream.language,
      visibility: stream.visibility,
      metadata: stream.metadata as Record<string, unknown> | null,
      status: stream.status,
      hosts: hosts.map((h) => ({ identity: h.identity, role: h.role, invitedAt: h.invitedAt.toISOString() })),
      viewerCount,
      peakViewerCount,
      conversationId: await this.conversationPublicId(stream),
      chatRootMessageId: stream.chatRootMessageId,
      scheduledAt: stream.scheduledAt?.toISOString() ?? null,
      startedAt: stream.startedAt?.toISOString() ?? null,
      endedAt: stream.endedAt?.toISOString() ?? null,
      createdAt: stream.createdAt.toISOString(),
      updatedAt: stream.updatedAt.toISOString(),
    };
  }

  private async conversationPublicId(stream: LiveStream): Promise<string | null> {
    if (!stream.conversationId) return null;
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: stream.conversationId },
      select: { publicId: true },
    });
    return conversation?.publicId ?? null;
  }
}
