import { Request } from 'express';

/**
 * The most specific identity a request actually carries, in priority
 * order: API key public id, then JWT user id, then client IP.
 *
 * Extracted from RateLimitGuard's original `subjectFor` so
 * IdempotencyInterceptor can key on exactly the same actor — two
 * concerns that both need "which caller is this, precisely" shouldn't
 * each grow their own answer to that question. See RateLimitGuard for
 * the full reasoning on why this ordering (in short: identity beats IP
 * whenever it's known, and a compromised/noisy API key must not spend
 * another key's budget just because they share a project).
 */
export function actorFor(request: Request): string {
  if (request.apiKeyPublicId) {
    return `apikey:${request.apiKeyPublicId}`;
  }

  const user = request.user as { id?: string } | undefined;
  if (user?.id) {
    return `user:${user.id}`;
  }

  return `ip:${request.ip ?? 'unknown'}`;
}
