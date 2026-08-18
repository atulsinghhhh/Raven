import { createHmac } from 'crypto';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * coturn's "REST API" time-limited credential scheme (the same mechanism
 * docs/architecture/turn.md described and turnserver.conf has been
 * configured for — `use-auth-secret` — since Phase 1).
 * username = "<unix-expiry>:<label>", credential = base64(HMAC-SHA1(secret, username)).
 * coturn derives the same value on its side to authenticate the ALLOCATE
 * request; nobody holds a permanent TURN login.
 */
export function generateTurnCredential(
  secret: string,
  ttlSeconds: number,
  label: string,
): { username: string; credential: string } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiresAt}:${label}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/**
 * Builds the full ICE server list a WebRTC client needs: our external
 * coturn deployment for STUN (candidate discovery) and TURN (relay
 * fallback) over every transport coturn is configured for — see
 * docs/architecture/turn.md and docs/sfu.md#turn-integration. Deliberately
 * does NOT include LiveKit's own embedded TURN (unused, per the Phase 0
 * decision to run coturn externally instead).
 *
 * Preference order clients should try (not enforced here — this is what
 * the browser's own ICE agent already does): direct/UDP, STUN-assisted,
 * TURN/UDP, TURN/TCP, TURN/TLS(+DTLS) — see docs/nat-traversal.md. `turns:`
 * is only included when `turnTlsPort` is provided, since a plain TURN
 * deployment (no cert configured) has no TLS listener to point at.
 */
export function buildIceServers(opts: {
  turnHost: string;
  turnPort: number;
  turnTlsPort?: number;
  turnSecret: string;
  participantIdentity: string;
  ttlSeconds: number;
}): IceServer[] {
  const { username, credential } = generateTurnCredential(
    opts.turnSecret,
    opts.ttlSeconds,
    opts.participantIdentity,
  );
  const hostPort = `${opts.turnHost}:${opts.turnPort}`;

  const servers: IceServer[] = [
    { urls: `stun:${hostPort}` },
    { urls: `turn:${hostPort}?transport=udp`, username, credential },
    { urls: `turn:${hostPort}?transport=tcp`, username, credential },
  ];

  if (opts.turnTlsPort) {
    // TURNS over TCP (TLS). coturn's `--dtls` flag also serves TURN-over-UDP
    // with DTLS on this same port, but there is no `?transport=` value for
    // that in the turns: URI scheme (RFC 7065) — TLS-over-TCP is the
    // interoperable, universally-supported option, so that's what's
    // advertised. See docs/turn.md#tls for the local self-signed-cert caveat.
    servers.push({
      urls: `turns:${opts.turnHost}:${opts.turnTlsPort}?transport=tcp`,
      username,
      credential,
    });
  }

  return servers;
}
