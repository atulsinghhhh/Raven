/**
 * HOST created the stream; CO_HOST was invited into it; VIEWER can only
 * subscribe. Which one you get is decided entirely server-side — by
 * whether your backend called `POST /v1/live-streams/:id/hosts` or
 * `.../viewer-tokens` — never by anything sent from this SDK.
 */
export type LiveStreamRole = 'HOST' | 'CO_HOST' | 'VIEWER';

/**
 * What `LiveStream.join()` needs — the response of `POST
 * /v1/live-streams/:id/hosts` or `.../viewer-tokens`, forwarded from your
 * backend as-is. Every field here already comes shaped this way from
 * those endpoints; nothing needs reassembling.
 */
export interface LiveStreamCredentials {
  /** The stream's id (`stream_...`) — also the RTC room this joins. */
  streamId: string;
  role: LiveStreamRole;
  /** The `rtc` field from the mint response — forward it as-is, same as any other `@corvidhq/rtc` token. */
  rtc: {
    token: string;
    endpoint: string;
    iceServers?: RTCIceServer[];
    telemetryUrl?: string;
  };
  /**
   * The `chat` field from the mint response. Omit entirely for an
   * RTC-only integration — `LiveStream.chat` is then undefined and
   * `react()` throws rather than silently doing nothing.
   */
  chat?: {
    token: string;
    apiUrl?: string;
    chatUrl?: string;
    /** Which conversation to connect to — the mint response's own `conversations` field (always one entry for a stream's chat token). */
    conversations: string[];
  };
  /** The stream's `chatRootMessageId` — what `react()` attaches reactions to. Omit if this stream has no chat. */
  chatRootMessageId?: string | null;
}
