import { WebSocket } from 'ws';
import { RtcTokenPermissionsDto } from '../../rtc-tokens/dto/rtc-token-permissions.dto';

/**
 * One authenticated WebSocket connection. Identity (`participantId`) comes
 * from the RTC token, NOT from `connectionId` — a reconnect gets a new
 * connectionId but must be treated as the same participant. See
 * docs/signaling.md#reconnection.
 */
export interface ParticipantSession {
  connectionId: string;
  participantId: string;
  projectId: string;
  roomId: string;
  permissions: RtcTokenPermissionsDto;
  socket: WebSocket;
  /** Set once room.join succeeds; false while merely authenticated. */
  joinedRoom: boolean;
  joinedAt: Date | null;
  isAlive: boolean;
  /** Sliding-window message timestamps for per-connection rate limiting. */
  messageTimestamps: number[];
}
