import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import { ChatError } from '../chat-error';
import { ChatErrorCode, RedisKeys } from '../chat.constants';

export type ChatRateScope = 'send' | 'reaction' | 'typing' | 'subscribe' | 'connect';

/**
 * `windowKey` names a configuration entry where one exists, so an operator
 * who sets CHAT_SEND_RATE_WINDOW_SECONDS gets the window they asked for.
 * It previously did not: the send window was hardcoded to 10 here while
 * `chat.sendRateWindowSeconds` was parsed, documented in
 * self-hosting/environment-variables.md, and read by nothing. A setting
 * that silently does nothing is worse than one that does not exist.
 *
 * `windowSeconds` remains the fallback for the scopes that genuinely have
 * no knob, so the defaults are still stated in one place.
 */
const SCOPE_CONFIG: Record<
  ChatRateScope,
  { limitKey: string; windowKey?: string; windowSeconds: number; label: string }
> = {
  send: {
    limitKey: 'chat.sendRateLimit',
    windowKey: 'chat.sendRateWindowSeconds',
    windowSeconds: 10,
    label: 'Sending messages',
  },
  reaction: { limitKey: 'chat.reactionRateLimit', windowSeconds: 10, label: 'Reacting' },
  typing: { limitKey: 'chat.typingRateLimit', windowSeconds: 10, label: 'Typing updates' },
  subscribe: { limitKey: 'chat.subscribeRateLimit', windowSeconds: 60, label: 'Room subscriptions' },
  connect: { limitKey: 'chat.connectionRateLimit', windowSeconds: 60, label: 'Connection attempts' },
};

/**
 * Per-subject rate limiting for the chat plane (spec §37). Redis-backed
 * rather than in-memory because chat runs behind a load balancer across
 * several gateway instances: an in-memory counter would let a client
 * multiply its budget by reconnecting to a different instance.
 *
 * Fixed-window INCR+EXPIRE, same approach as the HTTP RateLimitGuard.
 * A sliding window would be more precise at the boundary; it isn't worth
 * the extra Redis round-trips on the message hot path, and the failure
 * mode (briefly allowing up to 2× the limit across a window edge) is
 * benign for what this is protecting.
 */
@Injectable()
export class ChatRateLimitService {
  private readonly logger = new Logger(ChatRateLimitService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /** Throws a structured RATE_LIMITED ChatError (spec §37) instead of returning a boolean. */
  async consume(scope: ChatRateScope, projectId: string, subject: string): Promise<void> {
    const { limitKey, windowKey, windowSeconds: defaultWindow, label } = SCOPE_CONFIG[scope];
    const limit = this.configService.get<number>(limitKey)!;
    const configured = windowKey ? this.configService.get<number>(windowKey) : undefined;
    // A misconfigured window must not disable the limiter outright.
    const windowSeconds = configured && configured > 0 ? configured : defaultWindow;
    const key = RedisKeys.rateLimit(scope, projectId, subject);

    let count: number;
    try {
      count = await this.redisService.client.incr(key);
      if (count === 1) {
        await this.redisService.client.expire(key, windowSeconds);
      }
    } catch (err) {
      // Fail open. Redis being unreachable already degrades presence and
      // fan-out; also refusing every message would turn a partial outage
      // into a total one. Logged loudly so it isn't invisible.
      this.logger.error(`rate limiter unavailable, allowing request: ${(err as Error).message}`);
      return;
    }

    if (count > limit) {
      const ttl = await this.redisService.client.ttl(key).catch(() => windowSeconds);
      throw new ChatError(
        ChatErrorCode.RATE_LIMITED,
        `${label} is limited to ${limit} per ${windowSeconds}s — slow down`,
        ttl > 0 ? ttl : windowSeconds,
      );
    }
  }
}
