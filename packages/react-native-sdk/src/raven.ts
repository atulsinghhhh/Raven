import { RTCError, createRTCClient, type RTCClient, type Room } from '@raven/rtc';
import { audio } from './audio';
import { bootstrapRavenNative } from './internal/bootstrap';
import { LifecycleWatcher, NetworkWatcher, type RavenAppState } from './internal/lifecycle';
import { permissions } from './permissions';
import type { RavenConfig, RavenChatHandle } from './types';
import { createChatHandle } from './internal/chat-handle';

/**
 * Raven on React Native.
 *
 * The API is deliberately the same shape as Raven Web, because the
 * mental model is the thing worth keeping identical across platforms
 * (spec §10):
 *
 * ```ts
 * const raven = new Raven({ token, endpoint });
 * const room = await raven.join('room_123');
 * await room.enableCamera();
 * await room.enableMicrophone();
 * ```
 *
 * The `Room` it returns is the *same class* the web SDK returns, from
 * `@raven/rtc` — not a mobile re-implementation. Everything a developer
 * learned about rooms, participants, tracks and events on web is true
 * here, and any fix to that logic lands on both platforms at once.
 *
 * What this class adds on top is the handful of things a phone genuinely
 * needs and a browser doesn't: WebRTC globals, an audio session around
 * the call, app-lifecycle awareness, and connectivity-triggered
 * reconnects.
 *
 * RTC is optional. A messaging-only app supplies just a chat token and
 * never creates an RTC connection at all:
 *
 * ```ts
 * const raven = new Raven({ chatToken, chatApiUrl });
 * await raven.chat!.connect('room_123');
 * await raven.chat!.send('Hello');
 * ```
 */
export class Raven {
  /**
   * Messaging. Present only when `@raven/chat` is installed and a
   * `chatToken` was supplied — chat is optional, and an RTC-only app
   * shouldn't have to install it.
   */
  readonly chat?: RavenChatHandle;

  /** Camera and microphone permissions. See `permissions` for the platform differences. */
  readonly permissions = permissions;

  /** Call audio routing — speakerphone, headsets, Bluetooth. */
  readonly audio = audio;

  /** Absent for a messaging-only app — see the constructor. */
  private readonly client?: RTCClient;
  private readonly config: RavenConfig;
  private readonly lifecycle: LifecycleWatcher;
  private readonly network: NetworkWatcher;

  private currentRoom?: Room;
  private audioSessionActive = false;

  constructor(config: RavenConfig) {
    // Before anything else: without the WebRTC globals in place,
    // constructing an RTC client would fail in ways that look like a
    // Raven bug rather than a missing polyfill.
    bootstrapRavenNative();

    this.config = config;

    // Only build an RTC client when there are RTC credentials to build it
    // with. A messaging-only app shouldn't have to mint a meaningless RTC
    // token just to construct this class — the two planes are independent
    // everywhere else in Raven, and this is where that has to hold too.
    if (config.token && config.endpoint) {
      this.client = createRTCClient({
        token: config.token,
        endpoint: config.endpoint,
        iceServers: config.iceServers,
        telemetryUrl: config.telemetryUrl,
        telemetry: config.telemetry,
        logLevel: config.logLevel,
        autoReconnect: config.autoReconnect ?? true,
      });
    } else if (config.token || config.endpoint) {
      // One without the other is always a mistake, and failing here is far
      // kinder than failing at join() with a connection error.
      throw new RTCError(
        'INVALID_TOKEN',
        'Raven needs both `token` and `endpoint` for RTC, or neither for a messaging-only app. Both come from the same token-mint response.',
      );
    }

    if (!config.token && !config.chatToken) {
      throw new RTCError(
        'INVALID_TOKEN',
        'Raven needs at least one credential: `token` + `endpoint` for calls, `chatToken` for messaging, or both.',
      );
    }

    if (config.chatToken) {
      this.chat = createChatHandle({
        token: config.chatToken,
        apiUrl: config.chatApiUrl ?? config.telemetryUrl,
        chatUrl: config.chatUrl,
        logLevel: config.logLevel,
        onTokenExpiring: config.onChatTokenExpiring,
      });
    }

    this.lifecycle = new LifecycleWatcher({
      onForeground: () => this.handleForeground(),
      onBackground: () => this.handleBackground(),
    });

    this.network = new NetworkWatcher(() => this.handleNetworkRegained());
  }

  /** The room currently joined, if any. */
  get room(): Room | undefined {
    return this.currentRoom;
  }

  /**
   * True when this instance was given RTC credentials. False for a
   * messaging-only app, where `join()` will throw.
   */
  get hasRtc(): boolean {
    return this.client !== undefined;
  }

  /** Foreground/background state, as the OS last reported it. */
  get appState(): RavenAppState {
    return this.lifecycle.state;
  }

  /**
   * Joins a room and returns it.
   *
   * Requests camera and microphone permission first unless you pass
   * `requestPermissions: false` — on mobile, joining a call and *then*
   * discovering you can't publish is a worse experience than being asked
   * up front, and doing it here means the developer doesn't have to
   * remember. Set it false if your app has its own pre-call permission
   * screen.
   *
   * A denied permission does not prevent joining: you can still receive
   * other participants' audio and video. It surfaces when you try to
   * enable the device that was refused.
   */
  async join(roomId: string, options: { requestPermissions?: boolean } = {}): Promise<Room> {
    const client = this.client;
    if (!client) {
      // Checked before prompting or starting an audio session — a
      // messaging-only app must not see a camera permission dialog on its
      // way to an error.
      throw new RTCError(
        'INVALID_TOKEN',
        'This Raven instance has no RTC credentials, so it cannot join a room. Pass `token` and `endpoint` to enable calls, or use `raven.chat` for messaging.',
      );
    }

    if (options.requestPermissions !== false) {
      // Non-throwing on purpose — a user who declined the camera can
      // still legitimately join to listen.
      await this.permissions.request().catch(() => undefined);
    }

    // Start the audio session before connecting. Doing it afterwards
    // means the first moments of remote audio play through the wrong
    // route on iOS while the session is still being configured.
    await this.startAudioSession();

    try {
      const room = await client.join(roomId);
      this.currentRoom = room;

      this.lifecycle.start();
      this.network.start();

      return room;
    } catch (error) {
      // Never leave the audio session running for a call that didn't
      // happen — on iOS that keeps the app's audio category overridden
      // and can duck other apps' audio indefinitely.
      await this.stopAudioSession();
      throw error;
    }
  }

  /**
   * Leaves the room and releases everything mobile-specific: OS
   * listeners, the audio session, and any media the room was holding.
   *
   * Safe to call when not in a room.
   */
  async leave(): Promise<void> {
    this.lifecycle.stop();
    this.network.stop();

    await this.currentRoom?.leave().catch(() => undefined);
    this.currentRoom = undefined;

    await this.stopAudioSession();
  }

  /**
   * Full teardown, including chat. Call this when the screen unmounts —
   * `leave()` alone keeps the chat connection open, which is right when
   * moving between rooms and wrong when tearing the feature down.
   */
  async dispose(): Promise<void> {
    await this.leave();
    await this.chat?.disconnect().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private handleForeground(): void {
    // Nothing is force-reconnected here. LiveKit keeps the session alive
    // across a short background period, and tearing it down on every
    // app-switch would be far more disruptive than the occasional slow
    // ICE recovery. If the connection genuinely died, its own reconnect
    // logic is already running.
    this.config.onAppStateChange?.('active');
  }

  private handleBackground(): void {
    this.config.onAppStateChange?.('background');
  }

  /**
   * Connectivity came back — most often a Wi-Fi → cellular handover.
   *
   * LiveKit will notice on its own eventually, but "eventually" is an ICE
   * timeout away, and on mobile that transition happens often enough to
   * be worth shortcutting. Only nudges a connection that has actually
   * failed; a healthy one is left alone.
   */
  private handleNetworkRegained(): void {
    const state = this.currentRoom?.connectionState;
    if (state === 'disconnected' || state === 'failed') {
      this.config.onNetworkReconnect?.();
    }
  }

  private async startAudioSession(): Promise<void> {
    if (this.audioSessionActive || this.config.manageAudioSession === false) {
      return;
    }
    try {
      await this.audio.start();
      this.audioSessionActive = true;
    } catch {
      // A failed audio session is not a reason to fail the join — video
      // still works, and the error would be reported at a point where a
      // developer can do nothing about it.
    }
  }

  private async stopAudioSession(): Promise<void> {
    if (!this.audioSessionActive) {
      return;
    }
    this.audioSessionActive = false;
    await this.audio.stop().catch(() => undefined);
  }
}
