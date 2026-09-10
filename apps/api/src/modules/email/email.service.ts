import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../shared/redis/redis.service';
import { EmailRedisKeys, EmailType, hashRecipient, recipientDomain } from './email.constants';
import { EmailMetricsService } from './email.metrics.service';
import { RESEND_CLIENT, ResendEmailClient } from './resend.provider';
import { EmailBrand, RenderedEmail } from './templates';

/**
 * How a Resend error should be treated. The three cases behave
 * differently on purpose — retrying a bad address is pointless traffic,
 * and giving up on a 500 loses a password reset.
 */
export type ResendErrorClass = 'transient' | 'permanent' | 'provider_quota';

/**
 * Errors worth trying again. Everything absent from this set is a
 * permanent failure: a malformed address, an unverified sending domain,
 * a revoked key. Retrying those produces identical failures and burns the
 * per-second rate limit that a genuinely transient failure would need.
 *
 * Names come from the SDK's own RESEND_ERROR_CODE_KEY union, not from
 * guesswork about status codes.
 */
const TRANSIENT_RESEND_ERRORS = new Set([
  'rate_limit_exceeded',
  'internal_server_error',
  'application_error',
  'concurrent_idempotent_requests',
]);

/**
 * Their quota, not ours. Distinct from a transient failure because more
 * attempts cannot help until the day or month rolls over, and distinct
 * from a permanent failure because nothing is wrong with the message —
 * the operator needs to see this one, so it gets its own metric label.
 */
const PROVIDER_QUOTA_RESEND_ERRORS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);

export function classifyResendError(name: string): ResendErrorClass {
  if (PROVIDER_QUOTA_RESEND_ERRORS.has(name)) {
    return 'provider_quota';
  }
  return TRANSIENT_RESEND_ERRORS.has(name) ? 'transient' : 'permanent';
}

export type SendEmailResult =
  | { status: 'sent'; messageId: string }
  | { status: 'skipped'; reason: 'disabled' | 'cooldown' | 'daily_quota' | 'monthly_quota' }
  | {
      status: 'failed';
      reason: 'permanent' | 'transient_exhausted' | 'provider_quota';
      /** Provider message, safe to log. Never contains our key or the recipient's token. */
      error: string;
    };

export interface SendEmailInput {
  to: string;
  type: EmailType;
  email: RenderedEmail;
  /**
   * Defaults to true. Set false for a message whose whole job is to be
   * noticed — the password-changed notification, where a cooldown
   * swallowing the second one would hide an attacker's second change.
   */
  cooldown?: boolean;
  /**
   * Passed to Resend so a retry that crosses our own boundary (a caller
   * retried, not just the loop below) cannot produce two deliveries.
   */
  idempotencyKey?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The only thing in Livqeno that sends email.
 *
 *   caller → EmailService → Resend → mail.ravenstack.online → inbox
 *
 * Nothing here throws at the caller. Registration, password reset and
 * member-add all call into this, and none of them should fail because a
 * mail provider is having an afternoon — they get a result object and
 * decide. What they must never do is claim delivery: `skipped` and
 * `failed` are distinct from `sent` precisely so a caller cannot
 * accidentally treat "we logged it locally" as "it arrived".
 *
 * Three guards run before the API call, in this order:
 *
 *   1. **enabled** — no client, no send. Disabled logs what it would have
 *      sent and returns `skipped`, never a fake success.
 *   2. **cooldown** — one email of a given type per recipient per
 *      EMAIL_COOLDOWN_SECONDS. This is what stops a retry loop, a
 *      double-clicked button, or an impatient user turning one signup
 *      into fifty sends.
 *   3. **free-tier quota** — our own daily/monthly counters, checked
 *      before Resend's. Hitting our counter costs nothing; hitting
 *      theirs means the month's allowance is already gone.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly metrics: EmailMetricsService,
    @Optional() @Inject(RESEND_CLIENT) private readonly client: ResendEmailClient | null = null,
  ) {}

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Deployment-specific values every template's footer and links need. */
  get brand(): EmailBrand {
    return {
      appUrl: this.configService.get<string>('appUrl')!,
      supportEmail: this.configService.get<string>('email.supportEmail')!,
    };
  }

  get docsUrl(): string {
    return this.configService.get<string>('email.docsUrl')!;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const { type } = input;
    const domain = recipientDomain(input.to);
    this.metrics.recordAttempt(type);

    if (!this.client) {
      this.logger.log(
        `email skipped (EMAIL_ENABLED=false) type=${type} recipientDomain=${domain} subject="${input.email.subject}"`,
      );
      this.logDevPreview(input);
      this.metrics.recordSkip(type, 'disabled');
      return { status: 'skipped', reason: 'disabled' };
    }

    if (input.cooldown !== false && !(await this.acquireCooldown(type, input.to))) {
      this.logger.warn(`email suppressed by cooldown type=${type} recipientDomain=${domain}`);
      this.metrics.recordSkip(type, 'cooldown');
      return { status: 'skipped', reason: 'cooldown' };
    }

    const quota = await this.reserveQuota();
    if (quota !== 'ok') {
      // Loud on purpose: this is the free tier running out, and the next
      // person to sign up gets no verification email at all.
      this.logger.error(
        `email suppressed by Livqeno's own ${quota === 'daily_quota' ? 'daily' : 'monthly'} free-tier cap type=${type} recipientDomain=${domain} — raise EMAIL_${quota === 'daily_quota' ? 'DAILY' : 'MONTHLY'}_LIMIT only if the Resend plan actually allows it`,
      );
      this.metrics.recordSkip(type, quota);
      return { status: 'skipped', reason: quota };
    }

    return this.dispatch(input, domain);
  }

  private async dispatch(input: SendEmailInput, domain: string): Promise<SendEmailResult> {
    const maxAttempts = this.configService.get<number>('email.maxAttempts')!;
    const retryBaseMs = this.configService.get<number>('email.retryBaseMs')!;
    const fromEmail = this.configService.get<string>('email.fromEmail')!;
    const fromName = this.configService.get<string>('email.fromName')!;
    const replyTo = this.configService.get<string>('email.replyTo');
    const from = `${fromName} <${fromEmail}>`;

    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { data, error } = await this.client!.emails.send(
          {
            from,
            to: input.to,
            subject: input.email.subject,
            html: input.email.html,
            text: input.email.text,
            ...(replyTo ? { replyTo } : {}),
          },
          input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
        );

        if (!error) {
          const messageId = data?.id ?? 'unknown';
          this.logger.log(
            `email sent type=${input.type} recipientDomain=${domain} messageId=${messageId} attempt=${attempt}`,
          );
          this.metrics.recordSent(input.type);
          return { status: 'sent', messageId };
        }

        lastError = `${error.name}: ${error.message}`;
        const classification = classifyResendError(error.name);

        if (classification === 'permanent') {
          this.logger.error(
            `email failed permanently type=${input.type} recipientDomain=${domain} code=${error.name} status=${error.statusCode ?? 'none'} attempt=${attempt}`,
          );
          this.metrics.recordFailure(input.type, 'permanent');
          return { status: 'failed', reason: 'permanent', error: lastError };
        }

        if (classification === 'provider_quota') {
          this.logger.error(
            `email rejected — Resend plan quota exhausted type=${input.type} recipientDomain=${domain} code=${error.name}`,
          );
          this.metrics.recordFailure(input.type, 'provider_quota');
          return { status: 'failed', reason: 'provider_quota', error: lastError };
        }

        if (attempt >= maxAttempts) {
          break;
        }
        this.logger.warn(
          `email transient failure, retrying type=${input.type} recipientDomain=${domain} code=${error.name} attempt=${attempt}/${maxAttempts}`,
        );
      } catch (err) {
        // A thrown error is the network layer: DNS, TLS, timeout, socket
        // reset. Nothing about the message is wrong, so it retries.
        lastError = (err as Error).message;
        if (attempt >= maxAttempts) {
          break;
        }
        this.logger.warn(
          `email transport failure, retrying type=${input.type} recipientDomain=${domain} attempt=${attempt}/${maxAttempts}`,
        );
      }

      // Bounded exponential backoff: 500ms, 1s, 2s… Bounded by
      // maxAttempts, never a loop that runs until it works.
      await delay(retryBaseMs * 2 ** (attempt - 1));
    }

    this.logger.error(`email failed after ${maxAttempts} attempts type=${input.type} recipientDomain=${domain}`);
    this.metrics.recordFailure(input.type, 'transient_exhausted');
    return { status: 'failed', reason: 'transient_exhausted', error: lastError };
  }

  /**
   * `SET NX EX` — the same primitive the webhook worker's lock uses. True
   * means we took the slot; false means one went out recently.
   *
   * Fails **open**, matching every other Redis-backed guard in the API
   * (presence, rate limits, chat fan-out): a Redis blip must not stop a
   * password reset. The quota counters below are the backstop if Redis is
   * down long enough to matter.
   */
  private async acquireCooldown(type: EmailType, to: string): Promise<boolean> {
    const cooldownSeconds = this.configService.get<number>('email.cooldownSeconds')!;
    if (cooldownSeconds <= 0) {
      return true;
    }

    try {
      const key = EmailRedisKeys.cooldown(type, hashRecipient(to));
      const result = await this.redisService.client.set(key, '1', 'EX', cooldownSeconds, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.warn(`email cooldown check failed open: ${(err as Error).message}`);
      return true;
    }
  }

  /**
   * Counts the attempt against our own reading of the free tier before
   * Resend counts it against theirs.
   *
   * Reserves rather than settles: the counter increments before the send,
   * so a message that then fails still consumed a slot. That over-counts
   * slightly, and it is the right direction to be wrong in — the failure
   * mode of under-counting is discovering the month's quota is gone from
   * a user who never got their reset link.
   */
  private async reserveQuota(): Promise<'ok' | 'daily_quota' | 'monthly_quota'> {
    const dailyLimit = this.configService.get<number>('email.dailyLimit')!;
    const monthlyLimit = this.configService.get<number>('email.monthlyLimit')!;
    // Resend's quota windows are UTC; ours have to agree or the two roll
    // over at different moments and our cap stops meaning anything.
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);

    try {
      const monthly = await this.increment(EmailRedisKeys.monthlyQuota(month), 40 * 24 * 60 * 60);
      if (monthly > monthlyLimit) {
        return 'monthly_quota';
      }

      const daily = await this.increment(EmailRedisKeys.dailyQuota(day), 2 * 24 * 60 * 60);
      if (daily > dailyLimit) {
        return 'daily_quota';
      }

      return 'ok';
    } catch (err) {
      this.logger.warn(`email quota check failed open: ${(err as Error).message}`);
      return 'ok';
    }
  }

  private async increment(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.redisService.client.incr(key);
    if (value === 1) {
      await this.redisService.client.expire(key, ttlSeconds);
    }
    return value;
  }

  /**
   * Local-development escape hatch, off by default.
   *
   * Verification and reset links are single-use credentials, so they are
   * never logged in the normal path — not at debug, not in development.
   * But with email disabled there is otherwise no way to finish either
   * flow on a laptop, since the token exists only as a SHA-256 in
   * Postgres. EMAIL_DEV_PREVIEW=true prints the rendered text part, links
   * and all, and the boot refuses it when NODE_ENV=production
   * (env.validation.ts).
   */
  private logDevPreview(input: SendEmailInput): void {
    if (!this.configService.get<boolean>('email.devPreview')) {
      return;
    }
    if (this.configService.get<string>('env') === 'production') {
      return;
    }

    this.logger.warn(
      `EMAIL_DEV_PREVIEW is on — the message below contains live single-use links. Never enable this outside local development.\n` +
        `--- ${input.type} → ${input.to} ---\n${input.email.text}\n--- end ---`,
    );
  }
}
