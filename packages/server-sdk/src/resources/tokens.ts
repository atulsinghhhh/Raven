import type { RavenHttpClient } from '../http-client';
import type { CreateTokenParams, IssuedToken } from '../types';

/**
 * The core of this SDK (Phase 10 spec §15): mint a short-lived RTC token
 * server-side, then hand it to your frontend — never mint a token in the
 * browser, and never store a minted token any longer than you need to
 * forward it. Every token is short-lived by design; there is no way to
 * request a permanent one (see `expiresIn`).
 */
export class TokensResource {
  constructor(private readonly http: RavenHttpClient) {}

  create(params: CreateTokenParams): Promise<IssuedToken> {
    const { room, identity, permissions, expiresIn, metadata } = params;
    return this.http.request<IssuedToken>(`/v1/rooms/${room}/rtc-tokens`, {
      method: 'POST',
      body: {
        participantIdentity: identity,
        permissions,
        ttlSeconds: expiresIn,
        metadata,
      },
    });
  }
}
