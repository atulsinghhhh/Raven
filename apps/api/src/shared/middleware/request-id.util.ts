import { randomBytes } from 'crypto';

/**
 * Request IDs follow the same shape as every other public identifier in
 * Raven (`conv_`, `rvk_`, `ccn_`): a short prefix and an opaque body. A
 * developer reading a log line or an error response can tell what kind of
 * thing they are holding without being told.
 */
export const REQUEST_ID_PREFIX = 'req_';

/** Deliberately strict: prefix, then 1-64 url-safe characters, nothing else. */
const ACCEPTABLE_INBOUND = /^[A-Za-z0-9_-]{1,64}$/;

export function generateRequestId(): string {
  return `${REQUEST_ID_PREFIX}${randomBytes(12).toString('hex')}`;
}

/**
 * Resolves the ID for a request, preferring one the caller supplied.
 *
 * Honouring an inbound `x-request-id` is what lets a developer correlate
 * their own logs with ours across a call they initiated. It is also
 * attacker-controlled input that ends up in log lines and error bodies,
 * so it is accepted only when it is short and alphanumeric: anything
 * else (newlines, control characters, ANSI escapes, a megabyte of text)
 * is discarded in favour of a generated ID, not sanitised, because
 * a half-cleaned identifier is worth less than an honest new one.
 */
export function resolveRequestId(headerValue: unknown): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof candidate === 'string' && ACCEPTABLE_INBOUND.test(candidate)) {
    return candidate;
  }
  return generateRequestId();
}
