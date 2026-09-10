/**
 * Which CORS answer a request gets, and why it differs by route.
 *
 * Two kinds of browser caller reach this API and they need opposite
 * answers, so the policy cannot be one global allowlist.
 *
 * **SDK surfaces** are the endpoints a Raven SDK calls from the page:
 * `@ravenkash/rtc` posting connection telemetry, `@ravenkash/chat` reading
 * history and uploading attachments. They run on origins Raven cannot
 * enumerate — a different localhost port for every developer, a different
 * domain for every customer — so any fixed allowlist is wrong for them by
 * construction. These reflect the caller's origin.
 *
 * That is safe because the routes carry no ambient authority: credentials
 * are off, so a browser never attaches cookies cross-origin, and the only
 * credential is a short-lived token the developer's own backend minted.
 * A hostile page must already hold a valid token, and anything holding one
 * can use it from curl without a browser at all. The token is the control;
 * CORS never was.
 *
 * **Everything else** keeps the deployment's allowlist. Dashboard and
 * developer-session routes (`JwtAuthGuard`) are where origin restriction
 * genuinely earns its keep, and backend-to-backend routes
 * (`ApiKeyAuthGuard`) have no browser in the picture.
 *
 * The eventual answer for SDK surfaces is per-project origins a developer
 * declares in the dashboard. It is not implemented here because an HTTP
 * preflight is unauthenticated by design — `OPTIONS` carries no
 * `Authorization` header, so there is no project to look up yet. Doing it
 * properly means identifying the project from the path.
 */

/** Route prefixes a browser reaches with a short-lived SDK token. */
export const SDK_BROWSER_PATH_PREFIXES = ['/v1/telemetry', '/v1/chat'] as const;

/** Whether `url` addresses an SDK surface. Tolerates query strings. */
export function isSdkBrowserSurface(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0];
  return SDK_BROWSER_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * `true` reflects the caller's origin; an array restricts to it.
 *
 * `allowlist` is the parsed `CORS_ORIGIN`, already `true` when that was
 * `*` (local dev), in which case everything is permissive anyway.
 */
export function corsOriginFor(url: string | undefined, allowlist: true | string[]): true | string[] {
  return isSdkBrowserSurface(url) ? true : allowlist;
}

/** Parses `CORS_ORIGIN` into what `enableCors` wants. */
export function parseCorsAllowlist(configured: string): true | string[] {
  return configured.trim() === '*'
    ? true
    : configured
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}
