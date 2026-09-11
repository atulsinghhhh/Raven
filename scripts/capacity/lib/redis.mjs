/**
 * The fleet-wide signaling membership set, read straight from Redis.
 *
 * This is the leak detector that matters most for churn. The API keeps
 * `raven:signaling:room:<roomId>:participants` as the authoritative
 * cross-instance roster, and it is what `SIGNALING_MAX_PARTICIPANTS_PER_ROOM`
 * is enforced against. A viewer who leaves and is not removed from it
 * does not merely look untidy: it permanently consumes one of the room's
 * seats, so a long-running stream with ordinary churn would start
 * refusing joins it has room for.
 *
 * The set carries a TTL that is refreshed on join, so a slow drain is
 * expected to self-heal. A count that stays high across a whole sampling
 * window, while the SFU's own participant gauge has come down, is the
 * signature of a real leak rather than of the TTL not having elapsed.
 */
import Redis from 'ioredis';

export class SignalingRedis {
  constructor(url) {
    this.url = url;
    this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async connect() {
    this.client.on('error', () => {
      // Handled by the callers, which report a null rather than crashing
      // a two-hour soak over one dropped read.
    });
    await this.client.connect();
    return this;
  }

  async roomParticipantCount(roomId) {
    try {
      return await this.client.scard(`raven:signaling:room:${roomId}:participants`);
    } catch {
      return null;
    }
  }

  async roomParticipantIds(roomId) {
    try {
      return await this.client.smembers(`raven:signaling:room:${roomId}:participants`);
    } catch {
      return null;
    }
  }

  /** Total keys under the signaling namespace. Catches per-room key leaks a single room's count cannot see. */
  async signalingKeyCount() {
    try {
      let cursor = '0';
      let count = 0;
      do {
        const [next, keys] = await this.client.scan(cursor, 'MATCH', 'raven:signaling:*', 'COUNT', 500);
        cursor = next;
        count += keys.length;
      } while (cursor !== '0');
      return count;
    } catch {
      return null;
    }
  }

  async close() {
    try {
      await this.client.quit();
    } catch {
      /* already gone */
    }
  }
}
