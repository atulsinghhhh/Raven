/**
 * Only ever redirect somewhere inside this app. A `next` value that names a
 * host ("//evil.example", "https://…") or anything that isn't a plain
 * absolute path is discarded — open-redirect protection for the login and
 * OAuth flows, which pass `next` around in query strings and cookies.
 *
 * Its own module (no next/server import) so both route handlers and
 * client-adjacent code can use it, and it stays trivially testable.
 */
export function safeInternalPath(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return undefined;
  }
  return value;
}
