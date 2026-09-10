import { RavenChatConnectionError, toRavenChatError } from '../errors';

/**
 * The HTTP half of the SDK.
 *
 * Real-time delivery rides the socket. History, attachments and one-off
 * reads come through here, because asking a WebSocket for a paginated list
 * is the wrong shape entirely and would block the frame the next message is
 * waiting on.
 *
 * Authenticated with the same chat token as the socket. One credential, two
 * transports.
 */
export class RestClient {
  private token: string;

  constructor(
    private readonly baseUrl: string,
    token: string,
  ) {
    this.token = token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; query?: Record<string, unknown> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: options.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      // fetch only rejects on a genuine network failure: DNS, offline,
      // CORS. An HTTP error status resolves, and gets handled below.
      throw new RavenChatConnectionError('Could not reach Livqeno', 'NETWORK_ERROR', error);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = (await response.json().catch(() => undefined)) as
      { code?: string; message?: string; retryAfterSeconds?: number } | undefined;

    if (!response.ok) {
      // The server's own Livqeno error code, not the HTTP status, so a caller
      // can tell MESSAGE_TOO_LARGE from ATTACHMENT_TOO_LARGE even though
      // both come back 413.
      throw toRavenChatError(payload?.code, payload?.message ?? `Request failed with status ${response.status}`, {
        retryAfterSeconds: payload?.retryAfterSeconds,
      });
    }

    return payload as T;
  }
}
