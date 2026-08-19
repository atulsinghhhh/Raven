import { OutboundSignalingMessage } from '../interfaces/signaling-message.interface';

/**
 * What travels over Redis pub/sub between signaling gateway instances.
 * One shape for every cross-instance intent, so there's no translation
 * layer to get out of sync (same reasoning as chat's `ChatEventEnvelope`).
 */
export type SignalingEventEnvelope =
  | {
      kind: 'broadcast';
      message: OutboundSignalingMessage;
      /** The participant who caused this event never needs an echo of it. */
      excludeParticipantId?: string;
    }
  | {
      kind: 'direct';
      targetParticipantId: string;
      message: OutboundSignalingMessage;
    }
  | {
      kind: 'kick';
      participantId: string;
      /** The connection that must NOT be kicked — the one that just replaced it. */
      exceptConnectionId: string;
    };
