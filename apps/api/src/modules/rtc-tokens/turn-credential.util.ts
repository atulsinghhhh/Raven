import { createHmac } from 'crypto';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * coturn's time-limited REST credential scheme (`use-auth-secret` in
 * turnserver.conf). username = "<unix-expiry>:<label>", credential =
 * base64(HMAC-SHA1(secret, username)) — coturn recomputes the same hash
 * to authenticate the ALLOCATE request, so nobody needs a permanent login.
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
 * Builds the ICE server list a WebRTC client needs: our own coturn
 * deployment, for both STUN and TURN, over whatever transports coturn's
 * configured for. Doesn't include LiveKit's embedded TURN — we run coturn
 * externally instead.
 *
 * The browser's ICE agent already picks the right order to try these in
 * (direct, STUN, TURN/UDP, TURN/TCP, TURN/TLS), so we don't enforce one
 * here. `turns:` only shows up when turnTlsPort is set — no cert on
 * coturn means no TLS listener to point at.
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
    // TURNS over TCP (TLS). coturn's --dtls flag also serves TURN-over-UDP
    // with DTLS on the same port, but the turns: URI scheme has no
    // `?transport=` value for that, so TLS-over-TCP is what we advertise —
    // it's the option every client actually supports.
    servers.push({
      urls: `turns:${opts.turnHost}:${opts.turnTlsPort}?transport=tcp`,
      username,
      credential,
    });
  }

  return servers;
}
