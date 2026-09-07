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
 * The old router's job was finding another participant to forward an SDP
 * or ICE message to. There is no such thing here: every client has exactly
 * one peer, the SFU node serving its room, so negotiation messages are
 * *relayed to the media plane* rather than routed between browsers.
 *
 * What is left is the part that always mattered — checking that the token
 * allows what is being asked, resolving which node serves the room, and
 * describing what the room should be told. The gateway still owns every
 * socket write and every Redis publish; this returns intent.
 *
 * # Ordering
 *
 * `room.join` is the only message that does real work before the client
 * can do anything else, and it does it in a deliberate order: authorize,
 * allocate a node, register fleet-wide, then ask the node for a
 * PeerConnection. Allocating before registering would leave a participant
 * counted in a room the node never learned about if the node were
 * unreachable.
 */
@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);

  constructor(
    private readonly roomRegistry: RoomRegistryService,
    private readonly trackRegistry: RoomTrackRegistryService,
    private readonly allocator: RtcServerAllocatorService,
    private readonly sfuLink: SfuLinkService,
  ) {}

  async route(
    session: ParticipantSession,
    message: InboundSignalingMessage,
  ): Promise<SignalingActionResult> {
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

  private async handleJoin(
    session: ParticipantSession,
    message: RoomJoinMessage,
  ): Promise<SignalingActionResult> {
    if (!session.permissions.join) {
      throw new SignalingError(SignalingErrorCode.PERMISSION_DENIED, 'join permission required');
    }

    // The RTC token is what actually authorizes the room — if the client
    // sends a roomId too, it has to match the token, not override it.
    if (message.roomId && message.roomId !== session.roomId) {
      throw new SignalingError(
        SignalingErrorCode.UNAUTHORIZED,
        'roomId does not match the room authorized by this RTC token',
      );
    }

    const server = await this.allocateServer(session, message.region);
    session.rtcServerId = server.id;
    session.rtcServerName = server.name;

    const { existingParticipantIds, wasReconnect } = await this.roomRegistry.join(session);
    session.joinedRoom = true;
    session.joinedAt = new Date();

    // Ask the node for a PeerConnection. It answers asynchronously with an
    // offer on the node link, which the frame handler relays to this
    // client — so `room.joined` below is not the end of joining, only the
    // end of the control-plane part of it.
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
      // Undo the fleet registration: a participant the node never learned
      // about must not be counted in the room, or the next joiner is told
      // about someone who will never publish anything.
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
        // The node's *name*, never its address — a client that learned an
        // SFU's address could connect to it directly, and then the media
        // plane could not be changed without breaking that client.
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
      // Only a genuine reconnect needs the stale session (possibly on a
      // different instance) closed — an ordinary first join has nothing
      // to kick, and skipping the broadcast keeps the common case at one
      // Redis publish instead of two.
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
      // Best-effort: the node tears the PeerConnection down on its own
      // when it dies, so a lost frame here costs a slightly later cleanup
      // rather than a leak.
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

    // Release the room's node assignment once the last participant has
    // gone, so the next call in this room is allocated fresh rather than
    // pinned to a node that may since have been drained.
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
   * Drops the room→node assignment when nobody is left.
   *
   * Reads fleet membership rather than the local view: the last
   * participant on *this* instance is not necessarily the last in the
   * room.
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

  private async handleSdpOffer(
    session: ParticipantSession,
    message: SdpOfferMessage,
  ): Promise<SignalingActionResult> {
    if (!session.permissions.publish) {
      // A client only offers in order to publish. Refusing here means an
      // unauthorized publish never reaches the media plane at all —
      // though the node checks again anyway (spec §38).
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

    await this.trackRegistry.setMuted(
      session.roomId,
      session.participantId,
      message.trackId,
      message.muted,
    );

    // Told to the room directly rather than waiting for the node to
    // report it: a mute has no observable effect on the wire other than
    // packets stopping, so there is no event coming back to relay, and a
    // UI that waited for one would show a stale indicator.
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
   * Records what a track being published is *of*, for the node.
   *
   * Sent by the client before it negotiates the track, so the source is
   * known by the time the media arrives — the node holds the declaration
   * against the track id and applies it when `OnTrack` fires.
   *
   * Best-effort: a lost declaration costs a screen share being labelled
   * as a camera, which is a cosmetic wrong in one client's UI, not a
   * broken call. Failing the publish over it would be the worse trade.
   */
  private async handleTrackPublish(
    session: ParticipantSession,
    message: TrackPublishMessage,
  ): Promise<SignalingActionResult> {
    this.requireInRoom(session);

    if (!session.permissions.publish) {
      throw new SignalingError(
        SignalingErrorCode.PERMISSION_DENIED,
        'publish permission required to publish a track',
      );
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

    // Nothing goes back to the client, and nothing is announced to the
    // room yet: the room learns about the track from the node's own
    // `track.published`, once media is actually arriving. Announcing on
    // intent would show a tile for a track that might never appear.
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

    // Deliberately no confirmation to the client. The requested layer is a
    // preference, and the layer actually delivered depends on what the
    // publisher is sending — reporting success here would let a UI claim a
    // quality it may not be receiving (spec §19).
    return {};
  }

  /**
   * Relays a negotiation message to the node serving this session's room.
   *
   * Negotiation frames are sent with `send`, not `trySend`: losing an
   * answer or a candidate stalls the connection silently, and the client
   * needs to know so it can retry or reconnect.
   */
  private async relayToNode(
    session: ParticipantSession,
    type: NodeLinkMessageType,
    payload: unknown,
  ): Promise<void> {
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
   * The node serving this session, from the session where possible.
   *
   * Cached on the session because otherwise every ICE candidate — of which
   * there are dozens per join — would cost a database read on the
   * latency-sensitive path of establishing a connection.
   */
  private async serverFor(session: ParticipantSession): Promise<RtcServer | null> {
    if (session.rtcServerId) {
      const server = await this.allocator.serverById(session.rtcServerId);
      if (server) {
        return server;
      }
      // The node was deregistered under us. Fall through to the room's
      // current assignment rather than failing outright.
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
