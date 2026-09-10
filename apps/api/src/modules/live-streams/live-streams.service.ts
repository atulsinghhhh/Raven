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
import { SfuRoomStateService } from '../rooms/sfu-room-state.service';
import { RoomsService } from '../rooms/rooms.service';
import { IssuedRtcToken, RtcTokensService } from '../rtc-tokens/rtc-tokens.service';
import { WebhookEventsService } from '../webhooks/webhook-events.service';
import { AddHostDto } from './dto/add-host.dto';
import { CreateLiveStreamDto } from './dto/create-live-stream.dto';
import { UpdateLiveStreamDto } from './dto/update-live-stream.dto';
import { toJsonInput } from './json.util';

/** Prisma's unique-constraint code. Same helper, same reasoning, as ConversationsService. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

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
  /** Live participants of the underlying room who aren't registered hosts. `null` means the SFU was unreachable, which isn't the same as a genuine 0. */
  viewerCount: number | null;
  peakViewerCount: number;
  conversationId: string | null;
  /** The chat message viewer reactions hang off. See docs/live-streaming/overview.md#reactions. */
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
 * Live Streaming's whole media and messaging model is reuse.
 *
 * A stream is one RTC Room plus one Chat Conversation. Hosts, co-hosts and
 * viewers are ordinary participants of that room, and what separates them is
 * which endpoint minted their token and therefore which permission grant
 * they got (see createHostCredential and createViewerToken). The
 * conversation is attached exactly the way a video call's chat panel
 * already is.
 *
 * This service owns lifecycle and role bookkeeping on top of both. It never
 * duplicates what RoomsService, RtcTokensService, ConversationsService or
 * ChatTokenService already do correctly.
 */
@Injectable()
export class LiveStreamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
    private readonly roomState: SfuRoomStateService,
    private readonly rtcTokensService: RtcTokensService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly chatTokenService: ChatTokenService,
    private readonly webhooks: WebhookEventsService,
  ) {}

  async create(scope: ProjectScope, dto: CreateLiveStreamDto): Promise<LiveStreamView> {
    // One generated id serves as both the Room's and the Conversation's
    // name, so a stream never makes the developer think about either.
    // generateId's alphabet is base64url, already a subset of the
    // room/conversation name pattern, so there's nothing to sanitize.
    const publicId = generateId('stream');

    const room = await this.roomsService.create(scope, { name: publicId });
    const conversation = await this.conversationsService.create(scope, { name: publicId, roomId: room.id });

    // A system message for every viewer reaction to hang off (see the
    // toJsonInput note in the class doc). Reuses the existing Reaction model
    // rather than inventing a second realtime primitive purely for
    // "somebody tapped ❤️".
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

    // The list endpoint skips live state, i.e. viewer count. One SFU round
    // trip per row would make "list my streams" as slow as the slowest room
    // in it. Fetch a single stream if you want its live count.
    return Promise.all(streams.map(async (stream) => this.toView(stream, await this.activeHosts(stream.id), false)));
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
   * CREATED → LIVE.
   *
   * There's no separate call for the STARTING state, because nothing here
   * has an async provisioning step to represent; no recording or
   * transcoding setup exists yet. So start() validates the transition and
   * completes it in one request, instead of making a developer poll a
   * STARTING status that's never honestly observable.
   *
   * A repeat call is rejected, not treated as a no-op. A stream's startedAt
   * has to mean "actually started, once", not "most recently asked to
   * start".
   */
  async start(scope: ProjectScope, streamId: string): Promise<LiveStreamView> {
    const stream = await this.resolveRaw(scope, streamId);

    const startedAt = new Date();
    // The status is part of the WHERE, not a check performed before it.
    // Reading the row, deciding, then writing is two round trips with a gap
    // in the middle, and five simultaneous start() calls all read CREATED
    // in that gap and all wrote LIVE — five `live_stream.started` webhooks
    // and a startedAt belonging to whichever write landed last. Postgres
    // settles it instead: the transition is the write, so exactly one
    // caller can match CREATED and the rest match nothing.
    const { count } = await this.prisma.liveStream.updateMany({
      where: { id: stream.id, status: LiveStreamStatus.CREATED },
      data: { status: LiveStreamStatus.LIVE, startedAt },
    });
    if (count === 0) {
      // Re-read rather than echo the status from above: by now it is
      // whatever the winner set, and that is what the caller should be
      // told they lost to.
      const current = await this.resolveRaw(scope, streamId);
      throw new ConflictError(
        `Cannot start a stream that is ${current.status} — only a CREATED stream can be started`,
        RavenErrorCode.STREAM_INVALID_STATE,
      );
    }

    const updated = await this.resolveRaw(scope, streamId);

    void this.webhooks.emit(scope, 'live_stream.started', {
      streamId: updated.publicId,
      startedAt: startedAt.toISOString(),
    });

    return this.toView(updated, await this.activeHosts(updated.id), true);
  }

  /**
   * LIVE → ENDED, and that's terminal.
   *
   * Closes the underlying Room too, softly: RoomStatus.CLOSED, the same as a
   * developer calling `rooms.close()` themselves. So an ended stream can't be
   * rejoined by minting a fresh RTC token against its room.
   *
   * There's no ENDED → LIVE transition. Restarting an ended stream would
   * need a real replay/restart model, which this phase doesn't implement.
   * Create a new stream instead.
   */
  async end(scope: ProjectScope, streamId: string): Promise<LiveStreamView> {
    const stream = await this.resolveRaw(scope, streamId);

    const endedAt = new Date();
    // Conditional on LIVE for the same reason start() is conditional on
    // CREATED — see the comment there. Ending mattered more: four of five
    // simultaneous end() calls used to succeed, so a stream could emit
    // four `live_stream.ended` webhooks and close its room four times.
    const { count } = await this.prisma.liveStream.updateMany({
      where: { id: stream.id, status: LiveStreamStatus.LIVE },
      data: { status: LiveStreamStatus.ENDED, endedAt },
    });
    if (count === 0) {
      const current = await this.resolveRaw(scope, streamId);
      throw new ConflictError(
        `Cannot end a stream that is ${current.status} — only a LIVE stream can be ended`,
        RavenErrorCode.STREAM_INVALID_STATE,
      );
    }

    const updated = await this.resolveRaw(scope, streamId);
    await this.roomsService.close(stream.roomId, scope);

    void this.webhooks.emit(scope, 'live_stream.ended', {
      streamId: updated.publicId,
      endedAt: endedAt.toISOString(),
      durationMs: updated.startedAt ? endedAt.getTime() - updated.startedAt.getTime() : null,
    });

    return this.toView(updated, await this.activeHosts(updated.id), false);
  }

  /**
   * Registers, or re-registers, a host or co-host and mints their
   * credentials in one call: an RTC token with full publish permissions,
   * and a chat token with a moderator-or-above role, both scoped to this
   * stream's room and conversation.
   *
   * The role is only ever read from this endpoint's own DTO. There's no
   * field anywhere that a viewer token accepts which could turn it into a
   * host token.
   *
   * Omitting `role` for someone already registered leaves their role
   * alone; see `upsertHost`. Only a new registration falls back to
   * CO_HOST.
   */
  async addHost(scope: ProjectScope, streamId: string, dto: AddHostDto): Promise<IssuedStreamCredential> {
    const stream = await this.resolveRaw(scope, streamId);
    this.assertNotEnded(stream);

    const host = await this.upsertHost(stream.id, dto.identity, dto.role);

    const credential = await this.mintCredential(scope, stream, dto.identity, {
      rtcPublish: true,
      chatRole: host.role === LiveStreamHostRole.HOST ? ChatMemberRole.ADMIN : ChatMemberRole.MODERATOR,
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
   * Mints a viewer's credentials. Always subscribe-only on the RTC side and
   * MEMBER on the chat side, whatever the request says.
   *
   * The only route to publish access is addHost() above, called from the
   * developer's own backend and never by an untrusted client.
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
   * Explicit viewer-leave signal for `live_stream.viewer_left`.
   *
   * Worth stating this limitation plainly: nothing yet turns a dropped media
   * session into a stream-level event. An abrupt disconnect, a crash or a
   * lost network, isn't detected server-side for streams. The SFU knows the
   * peer connection failed; that signal simply isn't wired to live streams.
   *
   * So only a clean `stream.leave()` from the SDK fires this event.
   * Presence-style best-effort detection is real future work, and nothing
   * here pretends otherwise.
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

  /** Public id (`stream_...`) or internal uuid. Same dual-lookup convention as Room and Conversation. */
  private async resolveRaw(scope: ProjectScope, streamId: string): Promise<LiveStream> {
    const stream = streamId.startsWith('stream_')
      ? await this.prisma.liveStream.findUnique({ where: { publicId: streamId } })
      : await this.prisma.liveStream.findUnique({ where: { id: streamId } });

    // Cross-project and cross-environment lookups get the same "not found"
    // as a genuinely missing row. Same reasoning as Room and Conversation.
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

  /**
   * Registers or re-registers a host, and settles what their role should be.
   *
   * ## Why an omitted role is not the same as CO_HOST
   *
   * `role` defaults to CO_HOST because that is what this endpoint is
   * normally used for — a stream already has its HOST, set at creation.
   * But the default used to be applied to *existing* rows too, so
   * re-minting a host's credentials the way the quickstart does it —
   * `addHost(streamId, { identity: 'alice' })` for the same alice that
   * `create({ hostIdentity: 'alice' })` just registered — silently
   * demoted her to CO_HOST. The stream was then left with no HOST at all,
   * and her chat token came back without `chat:manage`.
   *
   * So an omitted role now means "leave whatever they already are", and
   * only an explicit one changes anything. Re-minting credentials is not
   * a statement about rank.
   *
   * ## Concurrency
   *
   * Two simultaneous calls for the same identity both find no row and both
   * insert, and one loses on `@@unique([streamId, identity])`. Prisma's
   * `upsert` does not retry that, so the loser surfaced as a 500. It is a
   * lost race, not a failure: the row the winner wrote is the row this
   * caller wanted, so read it back and carry on.
   */
  private async upsertHost(
    streamId: string,
    identity: string,
    role: LiveStreamHostRole | undefined,
  ): Promise<LiveStreamHost> {
    const where = { streamId_identity: { streamId, identity } };
    const existing = await this.prisma.liveStreamHost.findUnique({ where });

    if (existing) {
      return this.prisma.liveStreamHost.update({
        where,
        // Re-inviting someone who was removed reactivates the same row.
        data: { role: role ?? existing.role, removedAt: null },
      });
    }

    try {
      return await this.prisma.liveStreamHost.create({
        data: { streamId, identity, role: role ?? LiveStreamHostRole.CO_HOST },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      const winner = await this.prisma.liveStreamHost.findUnique({ where });
      if (!winner) {
        throw err;
      }
      return this.prisma.liveStreamHost.update({
        where,
        data: { role: role ?? winner.role, removedAt: null },
      });
    }
  }

  private activeHosts(streamId: string): Promise<LiveStreamHost[]> {
    return this.prisma.liveStreamHost.findMany({ where: { streamId, removedAt: null } });
  }

  /**
   * Viewer count is never stored. It's polled from the SFU on demand,
   * exactly like `RoomsService`'s own live participant count, and for the
   * same reason: a stored count drifts the instant anybody's connection
   * changes without telling Postgres.
   *
   * `withLiveState=false`, which is list, create and update, skips the SFU
   * round trip entirely.
   */
  private async toView(stream: LiveStream, hosts: LiveStreamHost[], withLiveState: boolean): Promise<LiveStreamView> {
    let viewerCount: number | null = null;
    let peakViewerCount = stream.peakViewerCount;

    if (withLiveState) {
      // Addressed by room id, which the stream already holds. No name
      // lookup needed; Livqeno's media plane is keyed by id.
      const liveParticipants = await this.roomState.listLiveParticipants(stream.roomId);

      if (liveParticipants) {
        const hostIdentities = new Set(hosts.map((h) => h.identity));
        viewerCount = liveParticipants.filter((p) => !hostIdentities.has(p.identity)).length;

        if (viewerCount > peakViewerCount) {
          peakViewerCount = viewerCount;
          // Best-effort high-water mark. A failed write here under-reports
          // a peak and corrupts nothing, so it stays out of the request's
          // success/failure path.
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
