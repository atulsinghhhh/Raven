import { OutboundSignalingMessage } from '../interfaces/signaling-message.interface';

/**
 * Uniform result shape every message handler returns, so the gateway can
 * execute it without caring which message type produced it.
 *
 * Every field beyond `toSender` describes an intent to be carried out via
 * `RoomEventsService` (Redis pub/sub) instead of a direct socket write;
 * the target may live on a different instance, so the router (which only
 * knows about rooms/participants, never sockets across the fleet) hands
 * back *what* should happen, and the gateway's room-events subscription
 * handler resolves *where* to actually deliver it once the envelope comes
 * back around.
 */
export interface SignalingActionResult {
  toSender?: OutboundSignalingMessage;
  /** Fan out to every other participant in the room, fleet-wide. */
  toRoom?: { roomId: string; message: OutboundSignalingMessage; excludeParticipantId?: string };
  /**
   * Close any other live connection for this participantId in this room,
   * fleet-wide.
   *
   * There is on purpose no "deliver to one participant" intent. The
   * mesh protocol needed one: it relayed an SDP offer from one browser to
   * another, and an SFU does not: a client's only peer is the node
   * serving its room, so a negotiation message goes to the media plane
   * over the node link, not to another participant. Everything left here
   * is genuinely room-wide.
   */
  kickParticipant?: { roomId: string; participantId: string; exceptConnectionId: string };
}
