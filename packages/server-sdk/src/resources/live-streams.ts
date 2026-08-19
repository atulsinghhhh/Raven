import type { RavenHttpClient } from '../http-client';
import type {
  AddHostParams,
  CreateLiveStreamParams,
  IssuedStreamCredential,
  LiveStream,
  ListLiveStreamsParams,
  UpdateLiveStreamParams,
} from '../types';

/**
 * Raven Live Streaming, server-side (Phase 14). A stream composes an RTC
 * room and a chat conversation — this resource only owns lifecycle and
 * role bookkeeping on top of them, the same reuse discipline the backend
 * itself follows.
 *
 * `addHost`/`createViewerToken` are the security-critical methods: the
 * role your caller ends up with is entirely determined by which method you
 * call, never by a field the request body accepts. A viewer token is
 * always subscribe-only; there is no way to ask this SDK for anything
 * else — `addHost` (called from your own backend, after your own auth
 * check) is the only path to publish access.
 */
export class LiveStreamsResource {
  constructor(private readonly http: RavenHttpClient) {}

  create(params: CreateLiveStreamParams): Promise<LiveStream> {
    return this.http.request<LiveStream>('/v1/live-streams', { method: 'POST', body: params });
  }

  list(params: ListLiveStreamsParams = {}): Promise<LiveStream[]> {
    const query = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
    return this.http.request<LiveStream[]>(`/v1/live-streams${query}`);
  }

  /** Includes the stream's live viewer count — `list()` does not, to avoid one SFU round trip per row. */
  get(streamId: string): Promise<LiveStream> {
    return this.http.request<LiveStream>(`/v1/live-streams/${encodeURIComponent(streamId)}`);
  }

  update(streamId: string, params: UpdateLiveStreamParams): Promise<LiveStream> {
    return this.http.request<LiveStream>(`/v1/live-streams/${encodeURIComponent(streamId)}`, {
      method: 'PATCH',
      body: params,
    });
  }

  /** CREATED → LIVE. */
  start(streamId: string): Promise<LiveStream> {
    return this.http.request<LiveStream>(`/v1/live-streams/${encodeURIComponent(streamId)}/start`, {
      method: 'POST',
    });
  }

  /** LIVE → ENDED, terminal. An ended stream cannot be restarted — create a new one. */
  end(streamId: string): Promise<LiveStream> {
    return this.http.request<LiveStream>(`/v1/live-streams/${encodeURIComponent(streamId)}/end`, {
      method: 'POST',
    });
  }

  /**
   * Registers a host/co-host and mints full-publish RTC + moderator-or-above
   * chat credentials in one call. Call again with the same identity to
   * re-mint fresh credentials (e.g. after the original ones expired).
   */
  addHost(streamId: string, params: AddHostParams): Promise<IssuedStreamCredential> {
    return this.http.request<IssuedStreamCredential>(`/v1/live-streams/${encodeURIComponent(streamId)}/hosts`, {
      method: 'POST',
      body: params,
    });
  }

  /** Soft removal — the host's chat history in the stream is preserved. */
  removeHost(streamId: string, identity: string): Promise<void> {
    return this.http.request<void>(
      `/v1/live-streams/${encodeURIComponent(streamId)}/hosts/${encodeURIComponent(identity)}`,
      { method: 'DELETE' },
    );
  }

  /** Always subscribe-only on RTC and MEMBER on chat — see the class doc. */
  createViewerToken(streamId: string, identity: string): Promise<IssuedStreamCredential> {
    return this.http.request<IssuedStreamCredential>(
      `/v1/live-streams/${encodeURIComponent(streamId)}/viewer-tokens`,
      { method: 'POST', body: { identity } },
    );
  }

  /**
   * A clean-leave signal for `live_stream.viewer_left`, not a disconnect
   * detector — Raven has no way to observe an abrupt viewer disconnect in
   * this phase. Call it when your own app knows a viewer left.
   */
  leave(streamId: string, identity: string): Promise<void> {
    return this.http.request<void>(`/v1/live-streams/${encodeURIComponent(streamId)}/leave`, {
      method: 'POST',
      body: { identity },
    });
  }
}
