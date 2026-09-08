/**
 * HOST created the stream, CO_HOST was invited into it, VIEWER can only
 * subscribe. Which one you get is decided entirely server-side, by whether
 * your backend called `POST /v1/live-streams/:id/hosts` or
 * `.../viewer-tokens`. Never by anything this SDK sends.
 */
export type LiveStreamRole = 'HOST' | 'CO_HOST' | 'VIEWER';

/**
 * What `LiveStream.join()` wants: the response from `POST
 * /v1/live-streams/:id/hosts` or `.../viewer-tokens`, forwarded out of
 * your backend untouched. Those endpoints already return it shaped exactly
 * like this. Nothing needs reassembling.
 */
export interface LiveStreamCredentials {
  /** The stream's id (`stream_...`), which doubles as the RTC room this joins. */
  streamId: string;
  role: LiveStreamRole;
  /** The `rtc` field from the mint response. Forward it untouched, like any other `@ravenkash/rtc` token. */
  rtc: {
    token: string;
    endpoint: string;
    iceServers?: RTCIceServer[];
    telemetryUrl?: string;
  };
  /**
   * The `chat` field from the mint response. Leave it out entirely for an
   * RTC-only integration. `LiveStream.chat` is then undefined, and
   * `react()` throws instead of quietly doing nothing.
   */
  chat?: {
    token: string;
    apiUrl?: string;
    chatUrl?: string;
    /** Which conversation to connect to. Comes from the mint response's `conversations` field, which always has exactly one entry for a stream's chat token. */
    conversations: string[];
  };
  /** The stream's `chatRootMessageId`, which is what `react()` hangs reactions off. Leave it out if this stream has no chat. */
  chatRootMessageId?: string | null;
}
