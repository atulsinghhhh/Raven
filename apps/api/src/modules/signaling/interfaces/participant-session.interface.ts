import { WebSocket } from 'ws';
import { RtcTokenPermissionsDto } from '../../rtc-tokens/dto/rtc-token-permissions.dto';
import { Environment } from '../../../shared/environment/environment.constants';
import { RtcPermissions } from '../../rtc-tokens/rtc-token.claims';

/**
 * One authenticated WebSocket connection.
 *
 * Identity comes from the RTC token's participantId, not connectionId — a
 * reconnect gets a new connectionId but is still the same participant.
 * `connectionId` doubles as the session id on the node link, so one
 * identifier follows a connection from the client's socket through to the
 * PeerConnection on the SFU.
 */
export interface ParticipantSession {
  connectionId: string;
  /** The RTC token's id (`jti`) — the correlation key for this connection's RTC logs. */
  tokenId: string;
  participantId: string;
  projectId: string;
  environment: Environment;
  roomId: string;
  roomName: string;
  permissions: RtcTokenPermissionsDto;
  /** The same grant in the shape the node link and the SFU use. */
  grant: RtcPermissions;
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
  /**
   * The RTC server serving this session's room, resolved at join.
   *
   * Held on the session so every subsequent frame (SDP, ICE, mute) can be
   * addressed without re-reading the room's assignment — a lookup that
   * would otherwise happen on the latency-sensitive path of every ICE
   * candidate.
   */
  rtcServerId?: string;
  rtcServerName?: string;
}
