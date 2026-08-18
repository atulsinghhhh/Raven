import { ParticipantSession } from '../interfaces/participant-session.interface';

/**
 * Per-connection sliding-window message rate limit. In-memory, not
 * Redis — this state only means anything to the one process holding the
 * live WebSocket, so there's nothing worth sharing across instances
 * (unlike the connection-level limit, which has to survive reconnects).
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
