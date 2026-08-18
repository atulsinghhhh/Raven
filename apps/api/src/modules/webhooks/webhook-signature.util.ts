import { createHmac, timingSafeEqual } from 'crypto';

/** Header carrying the signature. Documented for receivers in docs/chat/webhooks.md. */
export const WEBHOOK_SIGNATURE_HEADER = 'raven-signature';
export const WEBHOOK_EVENT_ID_HEADER = 'raven-event-id';
export const WEBHOOK_EVENT_TYPE_HEADER = 'raven-event-type';
/** How far a timestamp may drift before a receiver should reject the delivery. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * `t=<unix seconds>,v1=<hex hmac>` over `"<t>.<raw body>"`.
 *
 * The timestamp is inside the signed payload, not just alongside it, so a
 * captured delivery can't be replayed later with a fresher timestamp
 * bolted on — the signature wouldn't match. Receivers should reject
 * anything older than WEBHOOK_TOLERANCE_SECONDS (spec §39, replay
 * protection).
 *
 * The versioned `v1=` prefix leaves room to rotate the scheme without
 * breaking every existing receiver at once.
 */
export function signWebhookPayload(rawBody: string, secret: string, timestampSeconds: number): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}

/**
 * Reference verifier — this is what we tell developers to implement on
 * their side, and what the tests exercise. Constant-time compare, because
 * a naive `===` here leaks the expected signature one byte at a time.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = WEBHOOK_TOLERANCE_SECONDS,
): boolean {
  const parts = Object.fromEntries(
    header
      .split(',')
      .map((part) => part.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );

  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) {
    return false;
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
