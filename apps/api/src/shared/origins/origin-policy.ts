/**
 * Which browser origins may reach a project's SDK surfaces.
 *
 * Raven is multi-tenant, so this is a *per-project* decision: project A
 * listing `https://app-a.com` must never authorize it for project B. The
 * project always comes from the credential the caller presented (an RTC or
 * chat token's `pid`, or an API key's project), never from anything the
 * caller can choose, so there is no way to aim one tenant's allow-list at
 * another tenant's data.
 *
 * ## Why this is enforced in the server, not by CORS
 *
 * CORS cannot do per-tenant enforcement on HTTP. A preflight is
 * unauthenticated by design — `OPTIONS` carries no `Authorization` header —
 * so at the moment the browser asks "may I?", Raven does not yet know which
 * project is asking. Deriving it from the path would work but would mean
 * project-scoped URLs everywhere.
 *
 * So the split is: CORS headers stay permissive on SDK surfaces (they are a
 * capability probe carrying no data), and this policy is applied *after*
 * authentication, on the request that actually carries something. A
 * disallowed origin gets a 403 naming the problem rather than an opaque
 * browser CORS failure — which is also far better to debug, since a real
 * CORS block tells the developer nothing.
 *
 * The same policy governs WebSocket upgrades, where CORS does not apply at
 * all but the token — and therefore the project — is available immediately.
 */

/** Loopback hosts. A page on one of these is on the developer's own machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

export interface ProjectOriginPolicy {
  /**
   * Origins this project permits, already normalized. Empty means
   * unconfigured — see `isOriginAllowed`.
   */
  allowedOrigins: string[];
  /**
   * Whether loopback origins are permitted regardless of the list above.
   * Defaults on, so configuring production domains never breaks a
   * developer's own `localhost`.
   */
  allowLocalhostOrigins: boolean;
}

/**
 * Canonical form of an origin, or `undefined` if it is not one.
 *
 * Strict on purpose (spec §4). An origin is a scheme, a host and
 * optionally a port — nothing else. Anything carrying a path, query,
 * fragment, userinfo or wildcard is rejected rather than coerced, because
 * every one of those is either a developer misunderstanding worth
 * surfacing or an attempt to widen the match.
 *
 * Wildcards (`https://*.example.com`) are deliberately *not* supported.
 * They read as convenient and behave as a standing grant to every present
 * and future subdomain, including one an attacker manages to take over.
 * A project that genuinely needs many subdomains lists them.
 */
export function normalizeOrigin(input: string): string | undefined {
  const raw = input.trim();
  if (!raw || raw === '*' || raw === 'null' || raw.includes('*')) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  // `new URL` normalizes an empty path to "/", so that one is tolerated;
  // anything more specific was not an origin.
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    return undefined;
  }
  if (url.username || url.password) {
    return undefined;
  }
  if (!url.hostname) {
    return undefined;
  }

  const port = url.port && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : '';
  return `${url.protocol}//${url.hostname}${port}`;
}

/** Whether a normalized origin points at the caller's own machine. */
export function isLoopbackOrigin(normalizedOrigin: string): boolean {
  try {
    const { hostname } = new URL(normalizedOrigin);
    // URL keeps IPv6 hosts bracketed in `host` but not `hostname`.
    return LOOPBACK_HOSTS.has(hostname) || LOOPBACK_HOSTS.has(`[${hostname}]`);
  } catch {
    return false;
  }
}

/**
 * Whether `origin` may act on this project's behalf.
 *
 * `undefined`/absent origin is allowed: a browser always sends `Origin`, so
 * a request without one is a server-side caller, and those are not what
 * this control is for. It is not a bypass either — the caller still needs a
 * valid token, and a token holder can always drop the header, which is
 * precisely why origin checks are defence in depth rather than
 * authentication.
 *
 * An **empty** `allowedOrigins` means unconfigured, and unconfigured is
 * open. That is a deliberate migration choice, not an oversight: every
 * project that existed before this policy has an empty list, and defaulting
 * those to "deny" would break live applications on their real domains for a
 * setting nobody had the chance to fill in. Enforcement switches on for a
 * project the moment it adds its first origin, and the dashboard says so.
 */
export function isOriginAllowed(origin: string | undefined | null, policy: ProjectOriginPolicy): boolean {
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    // A browser cannot send a malformed Origin, so this is a hand-rolled
    // client. Refuse rather than guess what it meant.
    return false;
  }

  if (policy.allowedOrigins.length === 0) {
    return true;
  }

  if (policy.allowLocalhostOrigins && isLoopbackOrigin(normalized)) {
    return true;
  }

  return policy.allowedOrigins.includes(normalized);
}

/**
 * Validates a list a developer typed, returning the normalized values or
 * the entries that were not origins. Used by the dashboard-facing update
 * endpoint so bad input is refused at the boundary and the stored list is
 * always already canonical — matching at request time is then a plain
 * string comparison with nothing left to interpret.
 */
export function normalizeOriginList(inputs: string[]): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];

  for (const input of inputs) {
    const normalized = normalizeOrigin(input);
    if (!normalized) {
      invalid.push(input);
    } else if (!origins.includes(normalized)) {
      origins.push(normalized);
    }
  }

  return { origins, invalid };
}
