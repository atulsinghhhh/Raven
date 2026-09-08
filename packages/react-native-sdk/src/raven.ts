import { RTCError, createRTCClient, type RTCClient, type Room } from '@ravenkash/rtc';
import { audio } from './audio';
import { bootstrapRavenNative } from './internal/bootstrap';
import { LifecycleWatcher, NetworkWatcher, type RavenAppState } from './internal/lifecycle';
import { permissions } from './permissions';
import type { RavenConfig, RavenChatHandle } from './types';
import { createChatHandle } from './internal/chat-handle';

/**
 * Raven on React Native.
 *
 * The API is the same shape as Raven Web on purpose. The mental model is
 * the thing genuinely worth keeping identical across platforms (spec §10):
 *
 * ```ts
 * const raven = new Raven({ token, endpoint });
 * const room = await raven.join('room_123');
 * await room.enableCamera();
 * await room.enableMicrophone();
 * ```
 *
 * The `Room` you get back is the *same class* the web SDK returns, straight
 * out of `@ravenkash/rtc`. Not a mobile re-implementation. Everything anyone
 * learned about rooms, participants, tracks and events on web holds here,
 * and a fix to that logic lands on both platforms at once.
 *
 * What this class adds on top is the short list of things a phone actually
 * needs and a browser doesn't: WebRTC globals, an audio session wrapped
 * round the call, app-lifecycle awareness, and reconnects triggered by
 * connectivity changes.
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
   * Messaging. Only here when `@ravenkash/chat` is installed and a
   * `chatToken` was supplied. Chat is optional, and an RTC-only app
   * shouldn't be made to install it.
   */
  readonly chat?: RavenChatHandle;

  /** Camera and microphone permissions. `permissions` covers the platform differences. */
  readonly permissions = permissions;

  /** Call audio routing: speakerphone, headsets, Bluetooth. */
  readonly audio = audio;

  /** Not there for a messaging-only app. See the constructor. */
  private readonly client?: RTCClient;
  private readonly config: RavenConfig;
  private readonly lifecycle: LifecycleWatcher;
  private readonly network: NetworkWatcher;

  private currentRoom?: Room;
  private audioSessionActive = false;

  constructor(config: RavenConfig) {
    // First thing, before anything else. Without the WebRTC globals in
    // place, constructing an RTC client fails in ways that look like a
    // Raven bug, not a missing polyfill.
    bootstrapRavenNative();

    this.config = config;

    // Only build an RTC client if there are RTC credentials to build one
    // from. A messaging-only app shouldn't have to mint a pointless RTC
    // token just to construct this class. The two planes are independent
    // everywhere else in Raven, and that has to hold here as well.
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
      // One without the other is always a mistake, and failing here is a
      // great deal kinder than failing at join() with a connection error.
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
   * True if this instance got RTC credentials. False for a messaging-only
   * app, where `join()` throws.
   */
  get hasRtc(): boolean {
    return this.client !== undefined;
  }

  /** Foreground or background, as the OS last told us. */
  get appState(): RavenAppState {
    return this.lifecycle.state;
  }

  /**
   * Joins a room and hands it back.
   *
   * Asks for camera and microphone permission first, unless you pass
   * `requestPermissions: false`. On mobile, joining a call and *then*
   * finding out you can't publish is a worse experience than being asked up
   * front, and doing it here means nobody has to remember to. Set it false
   * if your app has its own pre-call permission screen.
   *
   * A denied permission doesn't stop you joining. You'll still receive
   * everyone else's audio and video; the refusal only surfaces when you try
   * to enable the device in question.
   */
  async join(roomId: string, options: { requestPermissions?: boolean } = {}): Promise<Room> {
    const client = this.client;
    if (!client) {
      // Checked before we prompt or start an audio session. A
      // messaging-only app must not get a camera permission dialog on its
      // way to an error.
      throw new RTCError(
        'INVALID_TOKEN',
        'This Raven instance has no RTC credentials, so it cannot join a room. Pass `token` and `endpoint` to enable calls, or use `raven.chat` for messaging.',
      );
    }

    if (options.requestPermissions !== false) {
      // Doesn't throw, on purpose. Someone who declined the camera can
      // still quite legitimately join to listen.
      await this.permissions.request().catch(() => undefined);
    }

    // Audio session first, then connect. Do it the other way round and the
    // first moments of remote audio come out of the wrong route on iOS
    // while the session is still being configured.
    await this.startAudioSession();

    try {
      const room = await client.join(roomId);
      this.currentRoom = room;

      this.lifecycle.start();
      this.network.start();

      return room;
    } catch (error) {
      // Never leave the audio session up for a call that didn't happen. On
      // iOS that keeps the app's audio category overridden and can duck
      // other apps' audio indefinitely.
      await this.stopAudioSession();
      throw error;
    }
  }

  /**
   * Leaves the room and lets go of everything mobile-specific: OS
   * listeners, the audio session, whatever media the room was holding.
   *
   * Safe to call when you're not in a room.
   */
  async leave(): Promise<void> {
    this.lifecycle.stop();
    this.network.stop();

    await this.currentRoom?.leave().catch(() => undefined);
    this.currentRoom = undefined;

    await this.stopAudioSession();
  }

  /**
   * Full teardown, chat included. This is what you call when the screen
   * unmounts. `leave()` on its own keeps the chat connection open, which is
   * right for moving between rooms and wrong for tearing the feature down.
   */
  async dispose(): Promise<void> {
    await this.leave();
    await this.chat?.disconnect().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private handleForeground(): void {
    // We don't force a reconnect here. A PeerConnection survives a short
    // spell in the background, and tearing it down on every app-switch
    // would be far more disruptive than the occasional slow ICE recovery.
    // If the connection genuinely died, the SDK's own reconnect logic is
    // already on it.
    this.config.onAppStateChange?.('active');
  }

  private handleBackground(): void {
    this.config.onAppStateChange?.('background');
  }

  /**
   * Connectivity came back, usually a Wi-Fi → cellular handover.
   *
   * ICE does notice on its own eventually, but "eventually" is a timeout
   * away, and on mobile this happens often enough to be worth shortcutting.
   * Only nudges a connection that actually failed; a healthy one is left
   * well alone.
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
      // A failed audio session isn't a reason to fail the join. Video still
      // works, and the error would surface somewhere a developer can do
      // precisely nothing about it.
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
