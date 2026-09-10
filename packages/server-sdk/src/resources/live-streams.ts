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
 * Livqeno Live Streaming, server-side (Phase 14).
 *
 * A stream composes an RTC room and a chat conversation. This resource only
 * owns lifecycle and role bookkeeping on top of those, following the same
 * reuse discipline the backend itself does.
 *
 * `addHost` and `createViewerToken` are the security-critical pair. The role
 * your caller ends up with is decided entirely by which method you call,
 * never by a field in the request body. A viewer token is always
 * subscribe-only, and there's no way to ask this SDK for anything else.
 * `addHost`, called from your own backend after your own auth check, is the
 * only route to publish access.
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

  /** Includes the stream's live viewer count. `list()` doesn't, to avoid an SFU round trip per row. */
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

  /** LIVE → ENDED, and that's terminal. You can't restart an ended stream; create a new one. */
  end(streamId: string): Promise<LiveStream> {
    return this.http.request<LiveStream>(`/v1/live-streams/${encodeURIComponent(streamId)}/end`, {
      method: 'POST',
    });
  }

  /**
   * Registers a host or co-host and mints full-publish RTC credentials plus
   * moderator-or-above chat credentials, all in one call. Call it again with
   * the same identity to re-mint fresh ones, say after the originals
   * expired.
   */
  addHost(streamId: string, params: AddHostParams): Promise<IssuedStreamCredential> {
    return this.http.request<IssuedStreamCredential>(`/v1/live-streams/${encodeURIComponent(streamId)}/hosts`, {
      method: 'POST',
      body: params,
    });
  }

  /** A soft removal. The host's chat history in the stream survives. */
  removeHost(streamId: string, identity: string): Promise<void> {
    return this.http.request<void>(
      `/v1/live-streams/${encodeURIComponent(streamId)}/hosts/${encodeURIComponent(identity)}`,
      { method: 'DELETE' },
    );
  }

  /** Always subscribe-only on RTC and MEMBER on chat. See the class doc. */
  createViewerToken(streamId: string, identity: string): Promise<IssuedStreamCredential> {
    return this.http.request<IssuedStreamCredential>(`/v1/live-streams/${encodeURIComponent(streamId)}/viewer-tokens`, {
      method: 'POST',
      body: { identity },
    });
  }

  /**
   * A clean-leave signal for `live_stream.viewer_left`. Not a disconnect
   * detector: Livqeno has no way to spot an abrupt viewer disconnect in this
   * phase. Call it when your own app knows a viewer left.
   */
  leave(streamId: string, identity: string): Promise<void> {
    return this.http.request<void>(`/v1/live-streams/${encodeURIComponent(streamId)}/leave`, {
      method: 'POST',
      body: { identity },
    });
  }
}
