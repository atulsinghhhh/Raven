import { Injectable, Logger } from '@nestjs/common';
import { RtcServer } from '../../../generated/prisma/client';
import { NoRtcCapacityError, RtcServerAllocatorService } from '../../rtc-servers/rtc-server-allocator.service';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import {
  IceCandidateMessage,
  InboundSignalingMessage,
  PublicParticipant,
  RoomJoinMessage,
  SdpAnswerMessage,
  SdpOfferMessage,
  SubscriptionUpdateMessage,
  TrackMuteMessage,
  TrackPublishMessage,
} from '../interfaces/signaling-message.interface';
import { UsageAllowanceService } from '../../usage/usage-allowance.service';
import { UsageMeterService } from '../../usage/usage-meter.service';
import { UsageCloseReason } from '../../usage/usage.constants';
import { RoomRegistryService } from '../rooms/room-registry.service';
import { RoomTrackRegistryService } from '../rooms/room-track-registry.service';
import { SfuLinkService } from '../sfu/sfu-link.service';
import {
  NodeLinkMessageType,
  ParticipantAddPayload,
  SdpPayload,
  SubscriptionUpdatePayload,
  TrackMutePayload,
  TrackSourcePayload,
} from '../sfu/node-link.interface';
import { SignalingError } from '../signaling-error';
import { ClientMessageType, ServerMessageType, SignalingErrorCode } from '../signaling.constants';
import { SignalingActionResult } from './signaling-action.interface';

/**
 * Turns client messages into control-plane decisions and node-link frames.
 *
 * # What changed from the mesh router this replaced
 *
 * The old router spent its life finding another participant to forward an
 * SDP or ICE message to. Nothing like that happens here. Every client has
 * exactly one peer, the SFU node serving its room, so negotiation messages
 * get *relayed to the media plane* instead of routed between browsers.
 *
 * What's left is the part that always mattered: checking the token allows
 * what's being asked, working out which node serves the room, and
 * describing what the room should be told. The gateway still owns every
 * socket write and every Redis publish. This returns intent.
 *
 * # Ordering
 *
 * `room.join` is the only message that does real work before the client can
 * do anything else, and the order it does it in is deliberate: authorize,
 * allocate a node, register fleet-wide, then ask the node for a
 * PeerConnection. Allocate before registering and an unreachable node
 * leaves a participant counted in a room it never heard about.
 */
@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);

  constructor(
    private readonly roomRegistry: RoomRegistryService,
    private readonly trackRegistry: RoomTrackRegistryService,
    private readonly allocator: RtcServerAllocatorService,
    private readonly sfuLink: SfuLinkService,
    private readonly usageAllowances: UsageAllowanceService,
    private readonly usageMeter: UsageMeterService,
  ) {}

  async route(session: ParticipantSession, message: InboundSignalingMessage): Promise<SignalingActionResult> {
    switch (message.type) {
      case ClientMessageType.ROOM_JOIN:
        return this.handleJoin(session, message);
      case ClientMessageType.ROOM_LEAVE:
        return this.handleLeave(session);
      case ClientMessageType.SDP_ANSWER:
        return this.handleSdpAnswer(session, message);
      case ClientMessageType.SDP_OFFER:
        return this.handleSdpOffer(session, message);
      case ClientMessageType.ICE_CANDIDATE:
        return this.handleIceCandidate(session, message);
      case ClientMessageType.TRACK_MUTE:
        return this.handleTrackMute(session, message);
      case ClientMessageType.TRACK_PUBLISH:
        return this.handleTrackPublish(session, message);
      case ClientMessageType.SUBSCRIPTION_UPDATE:
        return this.handleSubscriptionUpdate(session, message);
      case ClientMessageType.PING:
        return { toSender: { type: ServerMessageType.PONG } };
    }
  }

  private async handleJoin(session: ParticipantSession, message: RoomJoinMessage): Promise<SignalingActionResult> {
    if (!session.permissions.join) {
      throw new SignalingError(SignalingErrorCode.PERMISSION_DENIED, 'join permission required');
    }

    // The RTC token is what actually authorizes the room. If the client
    // sends a roomId as well, it has to match the token, not override it.
    if (message.roomId && message.roomId !== session.roomId) {
      throw new SignalingError(
        SignalingErrorCode.UNAUTHORIZED,
        'roomId does not match the room authorized by this RTC token',
      );
    }

    // Before anything is allocated: a project whose owner has spent their
    // included minutes gets no new sessions. Checked here rather than at
    // token mint alone because a token issued while minutes remained is
    // still a valid credential minutes later, and this is the last gate in
    // front of the media plane.
    //
    // Sessions already in progress are never affected — see
    // UsageAllowanceService.checkProject for why a live call is not cut
    // off mid-sentence.
    const { blocked } = await this.usageAllowances.checkProject(session.projectId);
    if (blocked) {
      this.logger.warn(
        `join refused: usage allowance exhausted for project ${session.projectId} ` +
          `(participant ${session.participantId}, room ${session.roomId})`,
      );
      throw new SignalingError(
        SignalingErrorCode.USAGE_LIMIT_EXCEEDED,
        'This account has used all of its included Raven minutes — no new sessions can be started',
      );
    }

    const server = await this.allocateServer(session, message.region);
    session.rtcServerId = server.id;
    session.rtcServerName = server.name;

    const { existingParticipantIds, wasReconnect } = await this.roomRegistry.join(session);
    session.joinedRoom = true;
    session.joinedAt = new Date();

    // Ask the node for a PeerConnection. It answers asynchronously with an
    // offer on the node link, which the frame handler relays on to this
    // client. So `room.joined` below isn't the end of joining, just the end
    // of the control-plane part.
    try {
      const payload: ParticipantAddPayload = {
        participantId: session.participantId,
        permissions: {
          publish: session.grant.publish,
          subscribe: session.grant.subscribe,
          publishAudio: session.grant.publishAudio,
          publishVideo: session.grant.publishVideo,
          publishData: session.grant.publishData,
        },
      };
      await this.sfuLink.send(server, {
        type: NodeLinkMessageType.PARTICIPANT_ADD,
        sessionId: session.connectionId,
        roomId: session.roomId,
        payload,
      });
    } catch (err) {
      // Undo the fleet registration. A participant the node never heard
      // about mustn't be counted in the room, or the next joiner gets told
      // about somebody who will never publish a thing.
      await this.roomRegistry.leave(session.roomId, session.participantId);
      session.joinedRoom = false;
      session.rtcServerId = undefined;
      session.rtcServerName = undefined;

      this.logger.error(
        `rtc server ${server.name} unreachable for participant ${session.participantId} in room ${session.roomId}: ${(err as Error).message}`,
      );
      throw new SignalingError(
        SignalingErrorCode.RTC_SERVER_UNREACHABLE,
        'The RTC server for this room could not be reached — please retry',
      );
    }

    // Open the meter only now: past the allocation, past the fleet
    // registration, and past the node accepting the participant. A join
    // that failed any of those never happened, and must not be billed.
    //
    // Best-effort on purpose. Metering must not be able to fail a join —
    // a database blip would otherwise take down calling itself — so the
    // failure is logged and the session runs unmetered rather than being
    // refused. Under-counting on a Raven fault is the right side to err on.
    try {
      await this.usageMeter.startSession({
        sessionKey: session.connectionId,
        projectId: session.projectId,
        environment: session.environment,
        roomId: session.roomId,
        roomName: session.roomName,
        participantIdentity: session.participantId,
      });
    } catch (err) {
      this.logger.error(
        `usage metering failed to start for session ${session.connectionId}: ${(err as Error).message}`,
      );
    }

    const tracksByParticipant = await this.trackRegistry.listByParticipant(session.roomId);
    const participants: PublicParticipant[] = existingParticipantIds.map((id) => ({
      id,
      tracks: tracksByParticipant.get(id) ?? [],
    }));

    this.logger.log(
      `participant joined: room=${session.roomId} participant=${session.participantId} ` +
        `session=${session.connectionId} rtcServer=${server.name} token=${session.tokenId} ` +
        `peers=${participants.length}`,
    );

    return {
      toSender: {
        type: ServerMessageType.ROOM_JOINED,
        roomId: session.roomId,
        participants,
        // The node's *name*, never its address. A client that learned an
        // SFU's address could connect to it directly, and from then on the
        // media plane couldn't change without breaking that client.
        rtcServer: server.name,
        region: server.region,
      },
      toRoom: {
        roomId: session.roomId,
        excludeParticipantId: session.participantId,
        message: {
          type: ServerMessageType.PARTICIPANT_JOINED,
          participant: { id: session.participantId, tracks: [] },
        },
      },
      // Only a genuine reconnect needs the stale session closed, and that
      // session may be on a different instance. An ordinary first join has
      // nothing to kick, and skipping the broadcast keeps the common case
      // at one Redis publish instead of two.
      kickParticipant: wasReconnect
        ? {
            roomId: session.roomId,
            participantId: session.participantId,
            exceptConnectionId: session.connectionId,
          }
        : undefined,
    };
  }

  private async allocateServer(session: ParticipantSession, requestedRegion?: string): Promise<RtcServer> {
    try {
      return await this.allocator.allocate(session.roomId, requestedRegion);
    } catch (err) {
      if (err instanceof NoRtcCapacityError) {
        this.logger.error(
          `no rtc capacity for room ${session.roomId} (requested region ${requestedRegion ?? 'default'})`,
        );
        throw new SignalingError(
          SignalingErrorCode.NO_RTC_CAPACITY,
          'No RTC server is available to host this room right now',
        );
      }
      throw err;
    }
  }

  private async handleLeave(session: ParticipantSession): Promise<SignalingActionResult> {
    this.requireInRoom(session);

    const server = await this.serverFor(session);
    if (server) {
      // Best-effort. The node tears the PeerConnection down by itself when
      // it dies, so losing this frame costs a slightly later cleanup rather
      // than a leak.
      await this.sfuLink.trySend(server, {
        type: NodeLinkMessageType.PARTICIPANT_REMOVE,
        sessionId: session.connectionId,
        roomId: session.roomId,
      });
    }
    this.sfuLink.releaseSession(session.connectionId);

    await this.trackRegistry.clearParticipant(session.roomId, session.participantId);
    await this.roomRegistry.leave(session.roomId, session.participantId);
    session.joinedRoom = false;

    // Credit the rest of this session and close its meter. Idempotent, so
    // the explicit `room.leave` and the disconnect cleanup that follows it
    // (SignalingGateway.handleDisconnect routes ROOM_LEAVE) settle the same
    // session twice and count it once. Best-effort for the same reason as
    // the start above: a failure here leaves a live row the reaper will
    // close at its last confirmed-alive instant.
    try {
      await this.usageMeter.settle(session.connectionId, { close: UsageCloseReason.LEFT });
    } catch (err) {
      this.logger.warn(`usage metering failed to settle session ${session.connectionId}: ${(err as Error).message}`);
    }

    // Release the room's node assignment once the last participant leaves,
    // so the next call in this room gets allocated fresh, not pinned
    // to a node that may since have been drained.
    await this.releaseRoomIfEmpty(session);

    this.logger.log(
      `participant left: room=${session.roomId} participant=${session.participantId} session=${session.connectionId}`,
    );

    return {
      toSender: { type: ServerMessageType.ROOM_LEFT, roomId: session.roomId },
      toRoom: {
        roomId: session.roomId,
        excludeParticipantId: session.participantId,
        message: {
          type: ServerMessageType.PARTICIPANT_LEFT,
          participant: { id: session.participantId },
        },
      },
    };
  }

  /**
   * Drops the room→node assignment once nobody's left.
   *
   * Reads fleet membership, not the local view. The last participant on
   * *this* instance isn't necessarily the last one in the room.
   */
  private async releaseRoomIfEmpty(session: ParticipantSession): Promise<void> {
    const remaining = await this.roomRegistry.countFleetWide(session.roomId);
    if (remaining > 0) {
      return;
    }
    await this.trackRegistry.clearRoom(session.roomId);
    await this.allocator.releaseRoom(session.roomId);
  }

  private async handleSdpAnswer(
    session: ParticipantSession,
    message: SdpAnswerMessage,
  ): Promise<SignalingActionResult> {
    await this.relayToNode(session, NodeLinkMessageType.SDP_ANSWER, {
      sdp: message.sdp,
      type: 'answer',
    } satisfies SdpPayload);
    return {};
  }

  private async handleSdpOffer(session: ParticipantSession, message: SdpOfferMessage): Promise<SignalingActionResult> {
    if (!session.permissions.publish) {
      // A client only ever offers in order to publish. Refusing here means
      // an unauthorized publish never reaches the media plane at all,
      // though the node checks again regardless (spec §38).
      throw new SignalingError(
        SignalingErrorCode.PERMISSION_DENIED,
        'publish permission required to negotiate an outgoing track',
      );
    }

    await this.relayToNode(session, NodeLinkMessageType.SDP_OFFER_FROM_CLIENT, {
      sdp: message.sdp,
      type: 'offer',
    } satisfies SdpPayload);
    return {};
  }

  private async handleIceCandidate(
    session: ParticipantSession,
    message: IceCandidateMessage,
  ): Promise<SignalingActionResult> {
    await this.relayToNode(session, NodeLinkMessageType.ICE_CANDIDATE, {
      candidate: message.candidate,
      sdpMid: message.sdpMid,
      sdpMLineIndex: message.sdpMLineIndex,
      usernameFragment: message.usernameFragment,
    });
    return {};
  }

  private async handleTrackMute(
    session: ParticipantSession,
    message: TrackMuteMessage,
  ): Promise<SignalingActionResult> {
    this.requireInRoom(session);

    const server = await this.serverFor(session);
    if (server) {
      await this.sfuLink.trySend(server, {
        type: NodeLinkMessageType.TRACK_MUTE,
        sessionId: session.connectionId,
        roomId: session.roomId,
        payload: { trackId: message.trackId, muted: message.muted } satisfies TrackMutePayload,
      });
    }

    await this.trackRegistry.setMuted(session.roomId, session.participantId, message.trackId, message.muted);

    // Told to the room directly rather than waiting on the node to report
    // it. A mute has no effect on the wire beyond packets stopping, so
    // there's no event coming back to relay, and a UI waiting for one would
    // sit there showing a stale indicator.
    return {
      toRoom: {
        roomId: session.roomId,
        excludeParticipantId: session.participantId,
        message: {
          type: message.muted ? ServerMessageType.TRACK_MUTED : ServerMessageType.TRACK_UNMUTED,
          participantId: session.participantId,
          trackId: message.trackId,
        },
      },
    };
  }

  /**
   * Records what a track being published is *of*, for the node's benefit.
   *
   * The client sends it before negotiating the track, so the source is known
   * by the time media arrives. The node holds the declaration against the
   * track id and applies it when `OnTrack` fires.
   *
   * Best-effort. A lost declaration means a screen share gets labelled as a
   * camera, which is cosmetically wrong in one client's UI, not a broken
   * call. Failing the publish over it would be the worse trade by miles.
   */
  private async handleTrackPublish(
    session: ParticipantSession,
    message: TrackPublishMessage,
  ): Promise<SignalingActionResult> {
    this.requireInRoom(session);

    if (!session.permissions.publish) {
      throw new SignalingError(SignalingErrorCode.PERMISSION_DENIED, 'publish permission required to publish a track');
    }

    const server = await this.serverFor(session);
    if (server) {
      await this.sfuLink.trySend(server, {
        type: NodeLinkMessageType.TRACK_SOURCE,
        sessionId: session.connectionId,
        roomId: session.roomId,
        payload: { trackId: message.trackId, source: message.source } satisfies TrackSourcePayload,
      });
    }

    // Nothing goes back to the client, and nothing is announced to the room
    // yet. The room hears about the track from the node's own
    // `track.published`, once media is genuinely arriving. Announce on
    // intent and you show a tile for a track that may never turn up.
    return {};
  }

  private async handleSubscriptionUpdate(
    session: ParticipantSession,
    message: SubscriptionUpdateMessage,
  ): Promise<SignalingActionResult> {
    this.requireInRoom(session);

    if (!session.permissions.subscribe) {
      throw new SignalingError(
        SignalingErrorCode.PERMISSION_DENIED,
        'subscribe permission required to change a subscription',
      );
    }

    const server = await this.serverFor(session);
    if (server) {
      await this.sfuLink.trySend(server, {
        type: NodeLinkMessageType.SUBSCRIPTION_UPDATE,
        sessionId: session.connectionId,
        roomId: session.roomId,
        payload: {
          publisherId: message.publisherId,
          trackId: message.trackId,
          layer: message.layer,
        } satisfies SubscriptionUpdatePayload,
      });
    }

    // No confirmation to the client, on purpose. The requested layer is a
    // preference, and what actually gets delivered depends on what the
    // publisher is sending. Report success here and a UI can claim a quality
    // it isn't receiving (spec §19).
    return {};
  }

  /**
   * Relays a negotiation message to whichever node serves this session's
   * room.
   *
   * Negotiation frames go out with `send`, not `trySend`. Lose an answer or
   * a candidate and the connection stalls in silence, so the client needs to
   * hear about it and retry or reconnect.
   */
  private async relayToNode(session: ParticipantSession, type: NodeLinkMessageType, payload: unknown): Promise<void> {
    this.requireInRoom(session);

    const server = await this.serverFor(session);
    if (!server) {
      throw new SignalingError(
        SignalingErrorCode.RTC_SERVER_UNREACHABLE,
        'This room is no longer assigned to an RTC server — rejoin to continue',
      );
    }

    try {
      await this.sfuLink.send(server, {
        type,
        sessionId: session.connectionId,
        roomId: session.roomId,
        payload,
      });
    } catch (err) {
      this.logger.warn(
        `relay of ${type} failed for session ${session.connectionId} to ${server.name}: ${(err as Error).message}`,
      );
      throw new SignalingError(
        SignalingErrorCode.RTC_SERVER_UNREACHABLE,
        'The RTC server for this room could not be reached',
      );
    }
  }

  /**
   * The node serving this session, read off the session where possible.
   *
   * Cached there because otherwise every ICE candidate costs a database
   * read, and there are dozens of those per join, right on the
   * latency-sensitive path of getting a connection up.
   */
  private async serverFor(session: ParticipantSession): Promise<RtcServer | null> {
    if (session.rtcServerId) {
      const server = await this.allocator.serverById(session.rtcServerId);
      if (server) {
        return server;
      }
      // The node got deregistered under us. Fall through to the room's
      // current assignment rather than fail outright.
      this.logger.warn(
        `rtc server ${session.rtcServerName ?? session.rtcServerId} no longer registered; re-reading room assignment`,
      );
      session.rtcServerId = undefined;
      session.rtcServerName = undefined;
    }

    const assigned = await this.allocator.assignedServerFor(session.roomId);
    if (assigned) {
      session.rtcServerId = assigned.id;
      session.rtcServerName = assigned.name;
    }
    return assigned;
  }

  private requireInRoom(session: ParticipantSession): void {
    if (!session.joinedRoom) {
      throw new SignalingError(SignalingErrorCode.NOT_IN_ROOM, 'You have not joined a room yet');
    }
  }
}
