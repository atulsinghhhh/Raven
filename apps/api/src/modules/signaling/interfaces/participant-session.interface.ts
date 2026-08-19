import { WebSocket } from 'ws';
import { RtcTokenPermissionsDto } from '../../rtc-tokens/dto/rtc-token-permissions.dto';

/**
 * One authenticated WebSocket connection. Identity comes from the RTC
 * token's participantId, not connectionId — a reconnect gets a new
 * connectionId but is still the same participant.
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
  /**
   * Releases this instance's ref-counted subscription to the room's
   * Redis channel. Set while `joinedRoom` is true; undefined otherwise.
   */
  roomEventsUnsubscribe?: () => Promise<void>;
}
