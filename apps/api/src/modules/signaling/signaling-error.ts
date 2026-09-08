import { ServerMessageType, SignalingErrorCode } from './signaling.constants';
import { ErrorMessage } from './interfaces/signaling-message.interface';

// Thrown by message handlers to bail out with a specific, safe error for
// the client: never a raw exception message or stack trace.
export class SignalingError extends Error {
  constructor(
    public readonly code: SignalingErrorCode,
    message: string,
  ) {
    super(message);
  }

  toMessage(): ErrorMessage {
    return { type: ServerMessageType.ERROR, code: this.code, message: this.message };
  }
}
