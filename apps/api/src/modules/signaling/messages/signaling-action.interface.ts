import { ParticipantSession } from '../interfaces/participant-session.interface';
import { OutboundSignalingMessage } from '../interfaces/signaling-message.interface';

/**
 * The uniform result shape every message handler returns, so the gateway
 * can execute it without needing to know which message type produced it.
 */
export interface SignalingActionResult {
  toSender?: OutboundSignalingMessage;
  toOthers?: Array<{ session: ParticipantSession; message: OutboundSignalingMessage }>;
  /** A previous connection for the same participant that must be closed. */
  kick?: ParticipantSession;
}
