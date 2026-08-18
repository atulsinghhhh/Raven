import { ParticipantSession } from '../interfaces/participant-session.interface';

/**
 * Per-connection sliding-window message rate limit. In-memory, not Redis
 * — this state is meaningless outside the single process holding the
 * live WebSocket connection, so there's nothing to share across
 * instances (unlike the connection-level limit, which must survive
 * reconnects from the same IP).
 */
export function checkMessageRate(
  session: ParticipantSession,
  maxMessages: number,
  windowSeconds: number,
): boolean {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  session.messageTimestamps = session.messageTimestamps.filter((ts) => ts > windowStart);
  session.messageTimestamps.push(now);

  return session.messageTimestamps.length <= maxMessages;
}
