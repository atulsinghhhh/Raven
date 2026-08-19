import { Room, RoomEvent, createLocalVideoTrack, createLocalAudioTrack, createLocalScreenTracks, ConnectionState, Track as Track$1, ConnectionError, ConnectionErrorReason, MediaDeviceFailure } from 'livekit-client';

// src/errors.ts
var RTCError = class extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "RTCError";
    this.code = code;
    this.cause = cause;
  }
};
function isRTCError(value) {
  return value instanceof RTCError;
}

// src/config.ts
function decodeTokenPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new RTCError("INVALID_TOKEN", "RTC token is malformed (expected a JWT with 3 parts)");
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(base64));
    return {
      room: json?.video?.room,
      exp: typeof json?.exp === "number" ? json.exp : void 0,
      sub: typeof json?.sub === "string" ? json.sub : void 0
    };
  } catch (error) {
    throw new RTCError("INVALID_TOKEN", "RTC token payload could not be decoded", error);
  }
}
function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new RTCError("INVALID_TOKEN", "createRTCClient(config) requires a configuration object");
  }
  if (!config.token || typeof config.token !== "string") {
    throw new RTCError("INVALID_TOKEN", "config.token is required \u2014 the RTC token from your backend");
  }
  if (!config.endpoint || typeof config.endpoint !== "string") {
    throw new RTCError(
      "INVALID_TOKEN",
      'config.endpoint is required \u2014 the "endpoint" field from the same token-mint response as config.token'
    );
  }
  const { exp } = decodeTokenPayload(config.token);
  if (exp !== void 0 && exp * 1e3 <= Date.now()) {
    throw new RTCError("TOKEN_EXPIRED", "RTC token has already expired");
  }
  return {
    token: config.token,
    endpoint: config.endpoint,
    iceServers: config.iceServers,
    logLevel: config.logLevel ?? "silent",
    autoReconnect: config.autoReconnect ?? true,
    telemetryUrl: config.telemetryUrl,
    telemetry: config.telemetry ?? true
  };
}
function assertTokenMatchesRoom(token, roomId) {
  const { room } = decodeTokenPayload(token);
  if (room && room !== roomId) {
    throw new RTCError("ROOM_NOT_FOUND", `This token was minted for room "${room}", not "${roomId}"`);
  }
}

// src/logger.ts
var LEVELS = ["silent", "error", "warn", "info", "debug"];
function createLogger(level = "silent") {
  const rank = LEVELS.indexOf(level);
  const enabled = (l) => LEVELS.indexOf(l) <= rank;
  return {
    error: (...args) => {
      if (enabled("error")) console.error("[raven-rtc]", ...args);
    },
    warn: (...args) => {
      if (enabled("warn")) console.warn("[raven-rtc]", ...args);
    },
    info: (...args) => {
      if (enabled("info")) console.info("[raven-rtc]", ...args);
    },
    debug: (...args) => {
      if (enabled("debug")) console.debug("[raven-rtc]", ...args);
    }
  };
}
async function listDevices(kind) {
  const infos = await Room.getLocalDevices(kind, true);
  return infos.map((info) => ({
    deviceId: info.deviceId,
    label: info.label,
    kind: info.kind
  }));
}

// src/internal/telemetry/track-stats.ts
var MS_PER_SECOND = 1e3;
function normalizeTrackStats(raw, previous, kind, direction) {
  const stats = { kind, direction };
  if (typeof raw.jitter === "number") {
    stats.jitterMs = raw.jitter * MS_PER_SECOND;
  }
  if (typeof raw.roundTripTime === "number") {
    stats.roundTripTimeMs = raw.roundTripTime * MS_PER_SECOND;
  }
  if (typeof raw.mimeType === "string") {
    stats.codec = raw.mimeType;
  }
  if (typeof raw.frameWidth === "number") stats.frameWidth = raw.frameWidth;
  if (typeof raw.frameHeight === "number") stats.frameHeight = raw.frameHeight;
  if (typeof raw.framesPerSecond === "number") stats.framesPerSecond = raw.framesPerSecond;
  if (typeof raw.packetsLost === "number") {
    stats.packetsLost = raw.packetsLost;
    const attempted = direction === "send" ? raw.packetsSent : raw.packetsReceived;
    if (typeof attempted === "number" && attempted + raw.packetsLost > 0) {
      stats.packetLossPercent = raw.packetsLost / (attempted + raw.packetsLost) * 100;
    }
  }
  const bytesField = direction === "send" ? "bytesSent" : "bytesReceived";
  const currentBytes = raw[bytesField];
  const previousBytes = previous?.[bytesField];
  if (typeof currentBytes === "number" && typeof previousBytes === "number") {
    const elapsedSeconds = (raw.timestamp - previous.timestamp) / MS_PER_SECOND;
    if (elapsedSeconds > 0 && currentBytes >= previousBytes) {
      stats.bitrateBps = (currentBytes - previousBytes) * 8 / elapsedSeconds;
    }
  }
  return stats;
}
function pickBestLayer(layers) {
  return layers.reduce((best, layer) => {
    const bestWidth = best?.frameWidth ?? -1;
    const layerWidth = layer.frameWidth ?? -1;
    return layerWidth > bestWidth ? layer : best;
  }, void 0);
}

// src/track.ts
var Track = class {
  constructor(delegate, kind) {
    this.delegate = delegate;
    this.kind = kind;
  }
  /** The underlying native track, for the rare case advanced access is needed. */
  get mediaStreamTrack() {
    return this.delegate.mediaStreamTrack;
  }
  get mediaStream() {
    return this.delegate.mediaStream;
  }
  get isMuted() {
    return this.delegate.isMuted;
  }
  /** Attaches this track to a `<video>`/`<audio>` element, creating one if omitted. */
  attach(element) {
    return this.delegate.attach(element);
  }
  /** Detaches this track from one element, or from all elements if omitted. */
  detach(element) {
    const result = this.delegate.detach(element);
    return Array.isArray(result) ? result : [result];
  }
};
var LocalTrack = class extends Track {
  constructor(delegate, kind) {
    super(delegate, kind);
    this.localDelegate = delegate;
  }
  async mute() {
    await this.localDelegate.mute();
  }
  async unmute() {
    await this.localDelegate.unmute();
  }
  /** Stops the underlying device capture. Publish state is managed by Room.unpublish(). */
  stop() {
    this.mediaStreamTrack.stop();
  }
  /**
   * Raven Effects (`@corvidhq/effects`) integration point — Camera → Raven
   * Video Track → Effects Pipeline → Processed Video Track → Raven RTC.
   * Runs `pipeline` against this track's live camera feed and, if already
   * published, swaps the sender's `MediaStreamTrack` in place via the
   * adapter's `replaceTrack()` — no renegotiation, no reconnect, audio and
   * the rest of the room are untouched. Camera-only today; screen share and
   * microphone aren't supported.
   *
   * If the pipeline can't run on this device (no WebGL2/Canvas2D/
   * captureStream), it degrades to the original track automatically — the
   * call keeps working either way.
   */
  async attachEffects(pipeline) {
    if (this.kind !== "camera") {
      throw new RTCError("MEDIA_ERROR", `attachEffects() is only supported on camera tracks, not "${this.kind}".`);
    }
    if (!this.localDelegate.replaceTrack) {
      throw new RTCError("MEDIA_ERROR", "This track cannot be swapped in place \u2014 the current adapter does not support replaceTrack().");
    }
    if (this.attachedEffectsPipeline) {
      await this.detachEffects();
    }
    const original = this.mediaStreamTrack;
    const processed = await pipeline.attachToTrack(original);
    if (processed !== original) {
      await this.localDelegate.replaceTrack(processed, true);
    }
    this.attachedEffectsPipeline = pipeline;
    this.preEffectsMediaStreamTrack = original;
  }
  /** Reverts to the unmodified camera track and releases the pipeline's engine resources. */
  async detachEffects() {
    if (!this.attachedEffectsPipeline) return;
    this.attachedEffectsPipeline.detach();
    if (this.preEffectsMediaStreamTrack && this.localDelegate.replaceTrack) {
      await this.localDelegate.replaceTrack(this.preEffectsMediaStreamTrack, true);
    }
    this.attachedEffectsPipeline = void 0;
    this.preEffectsMediaStreamTrack = void 0;
  }
  /**
   * Live send-side stats for this track — bitrate, packet loss, jitter,
   * RTT (audio only), resolution/fps (video only). `undefined` when the
   * adapter can't supply them (no `getSenderStats` on the delegate, or the
   * underlying call itself resolved to nothing) rather than a
   * zeroed-out object — see the module doc on why that distinction matters.
   *
   * Call this periodically (`Room.getConnectionStats()` does, every few
   * seconds) rather than once: bitrate needs two samples to compute, so
   * the very first call after a track starts always omits it.
   */
  async getStats() {
    const raw = await this.localDelegate.getSenderStats?.();
    if (!raw) {
      return void 0;
    }
    const sample = Array.isArray(raw) ? pickBestLayer(raw) : raw;
    if (!sample) {
      return void 0;
    }
    const stats = normalizeTrackStats(sample, this.lastSample, this.kind, "send");
    this.lastSample = sample;
    return stats;
  }
};
var RemoteTrack = class extends Track {
  constructor(delegate, kind) {
    super(delegate, kind);
    this.remoteDelegate = delegate;
  }
  /** Live receive-side stats for this track. See `LocalTrack.getStats()` for the shape and its caveats. */
  async getStats() {
    const raw = await this.remoteDelegate.getReceiverStats?.();
    if (!raw) {
      return void 0;
    }
    const stats = normalizeTrackStats(raw, this.lastSample, this.kind, "receive");
    this.lastSample = raw;
    return stats;
  }
};
function toMediaError(error, kind) {
  const failure = MediaDeviceFailure.getFailure(error);
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return new RTCError(permissionDeniedCode(kind), `Permission to use the ${kind} was denied`, error);
    case MediaDeviceFailure.NotFound:
      return new RTCError("DEVICE_NOT_FOUND", `No ${kind} device was found`, error);
    case MediaDeviceFailure.DeviceInUse:
      return new RTCError("MEDIA_ERROR", `The ${kind} device is already in use by another application`, error);
    default:
      return new RTCError("MEDIA_ERROR", `Could not access the ${kind}`, error);
  }
}
function permissionDeniedCode(kind) {
  if (kind === "camera") return "CAMERA_PERMISSION_DENIED";
  if (kind === "microphone") return "MICROPHONE_PERMISSION_DENIED";
  return "PERMISSION_DENIED";
}

// src/internal/media/camera.ts
async function createCameraTrack(deviceId) {
  try {
    const lkTrack = await createLocalVideoTrack(deviceId ? { deviceId } : void 0);
    return new LocalTrack(lkTrack, "camera");
  } catch (error) {
    throw toMediaError(error, "camera");
  }
}
async function createMicrophoneTrack(deviceId) {
  try {
    const lkTrack = await createLocalAudioTrack(deviceId ? { deviceId } : void 0);
    return new LocalTrack(lkTrack, "microphone");
  } catch (error) {
    throw toMediaError(error, "microphone");
  }
}
async function createScreenShareTrack() {
  try {
    const lkTracks = await createLocalScreenTracks({ audio: false });
    const [videoTrack] = lkTracks;
    return new LocalTrack(videoTrack, "screenShare");
  } catch (error) {
    throw toMediaError(error, "screenShare");
  }
}

// src/participant.ts
var Participant = class {
  constructor(identity, metadata) {
    this._identity = identity;
    this.metadata = metadata;
  }
  /** The RTC token's participant identity — stable for the session's duration. */
  get identity() {
    return this._identity;
  }
  /**
   * @internal Called once by the SFU adapter right after connect()
   * resolves — the constructor runs before the server confirms identity,
   * so this patches it in afterward.
   */
  _setIdentity(identity) {
    this._identity = identity;
  }
};
var LocalParticipant = class extends Participant {
  constructor() {
    super(...arguments);
    /** Tracks this participant has published, in publish order. Mutated by Room. */
    this.tracks = [];
  }
};
var RemoteParticipant = class extends Participant {
  constructor() {
    super(...arguments);
    /** Tracks subscribed from this participant, in subscribe order. Mutated by Room. */
    this.tracks = [];
  }
};

// src/events.ts
var TypedEventEmitter = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
  }
  on(event, handler) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }
  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
    return this;
  }
  once(event, handler) {
    const wrapped = ((...args) => {
      this.off(event, wrapped);
      handler(...args);
    });
    return this.on(event, wrapped);
  }
  removeAllListeners(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      handler(...args);
    }
  }
};

// src/internal/sfu/livekit-adapter.ts
var noRetryPolicy = { nextRetryDelayInMs: () => null };
function trackKindFromSource(source) {
  switch (source) {
    case Track$1.Source.Camera:
      return "camera";
    case Track$1.Source.Microphone:
      return "microphone";
    case Track$1.Source.ScreenShare:
    case Track$1.Source.ScreenShareAudio:
      return "screenShare";
    default:
      return "unknown";
  }
}
var CONNECTION_QUALITIES = ["excellent", "good", "poor", "lost", "unknown"];
function isConnectionQuality(value) {
  return CONNECTION_QUALITIES.includes(value);
}
function mapConnectionState(state) {
  switch (state) {
    case ConnectionState.Disconnected:
      return "disconnected";
    case ConnectionState.Connecting:
      return "connecting";
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return "reconnecting";
    default:
      return "disconnected";
  }
}
function mapConnectError(error) {
  if (error instanceof ConnectionError) {
    switch (error.reason) {
      case ConnectionErrorReason.NotAllowed:
        return new RTCError("INVALID_TOKEN", error.message, error);
      case ConnectionErrorReason.Timeout:
        return new RTCError("TIMEOUT", error.message, error);
      case ConnectionErrorReason.ServerUnreachable:
        return new RTCError("NETWORK_ERROR", error.message, error);
      case ConnectionErrorReason.WebSocket:
        return new RTCError("SIGNALING_ERROR", error.message, error);
      default:
        return new RTCError("CONNECTION_FAILED", error.message, error);
    }
  }
  return new RTCError("CONNECTION_FAILED", error instanceof Error ? error.message : "Failed to connect", error);
}
var LiveKitAdapter = class extends TypedEventEmitter {
  constructor(logger, autoReconnect) {
    super();
    this.intentionalDisconnect = false;
    this.wasReconnecting = false;
    this.remoteParticipants = /* @__PURE__ */ new Map();
    this.localTrackWrappers = /* @__PURE__ */ new WeakMap();
    this.remoteTrackWrappers = /* @__PURE__ */ new WeakMap();
    this._connectionState = "disconnected";
    this.logger = logger;
    this.lkRoom = new Room({
      reconnectPolicy: autoReconnect ? void 0 : noRetryPolicy
    });
    this.localParticipant = new LocalParticipant(this.lkRoom.localParticipant.identity || "");
    this.wireEvents();
  }
  get connectionState() {
    return this._connectionState;
  }
  getConnectionQuality() {
    const quality = this.lkRoom.localParticipant.connectionQuality;
    return isConnectionQuality(quality) ? quality : "unknown";
  }
  setConnectionState(state) {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this.emit("connectionStateChanged", state);
  }
  wireEvents() {
    const room = this.lkRoom;
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      const mapped = mapConnectionState(state);
      if (mapped === "reconnecting") this.wasReconnecting = true;
      if (mapped !== "disconnected") this.setConnectionState(mapped);
    });
    room.on(RoomEvent.Disconnected, () => {
      const failed = !this.intentionalDisconnect && this.wasReconnecting;
      this.setConnectionState(failed ? "failed" : "disconnected");
      this.wasReconnecting = false;
      this.intentionalDisconnect = false;
    });
    room.on(RoomEvent.ParticipantConnected, (lkParticipant) => {
      const participant = new RemoteParticipant(lkParticipant.identity, lkParticipant.metadata);
      this.remoteParticipants.set(lkParticipant.identity, participant);
      this.emit("participantJoined", participant);
    });
    room.on(RoomEvent.ParticipantDisconnected, (lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      this.remoteParticipants.delete(lkParticipant.identity);
      if (participant) this.emit("participantLeft", participant);
    });
    room.on(RoomEvent.TrackPublished, (publication, lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      if (participant) this.emit("trackPublished", trackKindFromSource(publication.source), participant);
    });
    room.on(RoomEvent.TrackUnpublished, (publication, lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      if (participant) this.emit("trackUnpublished", trackKindFromSource(publication.source), participant);
    });
    room.on(RoomEvent.TrackMuted, (publication, lkParticipant) => {
      if (lkParticipant.isLocal) return;
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      if (participant) this.emit("trackMuted", trackKindFromSource(publication.source), participant);
    });
    room.on(RoomEvent.TrackUnmuted, (publication, lkParticipant) => {
      if (lkParticipant.isLocal) return;
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      if (participant) this.emit("trackUnmuted", trackKindFromSource(publication.source), participant);
    });
    room.on(RoomEvent.TrackSubscribed, (lkTrack, publication, lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      if (!participant) return;
      const track = new RemoteTrack(lkTrack, trackKindFromSource(lkTrack.source));
      this.remoteTrackWrappers.set(lkTrack, track);
      participant.tracks.push(track);
      this.emit("trackSubscribed", track, participant);
    });
    room.on(RoomEvent.TrackUnsubscribed, (lkTrack, publication, lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      const track = this.remoteTrackWrappers.get(lkTrack);
      if (!participant || !track) return;
      const index = participant.tracks.indexOf(track);
      if (index !== -1) participant.tracks.splice(index, 1);
      this.remoteTrackWrappers.delete(lkTrack);
      this.emit("trackUnsubscribed", track, participant);
    });
    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      const track = this.localTrackWrappers.get(publication) ?? new LocalTrack(assertLocalTrack(publication), trackKindFromSource(publication.source));
      this.localTrackWrappers.set(publication, track);
      if (!this.localParticipant.tracks.includes(track)) this.localParticipant.tracks.push(track);
      this.emit("localTrackPublished", track);
    });
    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      const track = this.localTrackWrappers.get(publication);
      if (!track) return;
      const index = this.localParticipant.tracks.indexOf(track);
      if (index !== -1) this.localParticipant.tracks.splice(index, 1);
      this.localTrackWrappers.delete(publication);
      this.emit("localTrackUnpublished", track);
    });
    room.on(RoomEvent.DataReceived, (payload, lkParticipant) => {
      const participant = lkParticipant ? this.remoteParticipants.get(lkParticipant.identity) : void 0;
      this.emit("dataReceived", payload, participant);
    });
    room.on(RoomEvent.MediaDevicesError, (error) => {
      this.emit("mediaError", error);
    });
  }
  /**
   * ParticipantConnected/TrackSubscribed only fire for stuff that arrives
   * *after* our listeners attach. livekit-client's already populated
   * room.remoteParticipants by the time connect() resolves, so anyone who
   * joined earlier has to be picked up here manually — otherwise they'd
   * never show up for whoever joins second.
   */
  bootstrapExistingParticipants() {
    for (const lkParticipant of this.lkRoom.remoteParticipants.values()) {
      const participant = new RemoteParticipant(lkParticipant.identity, lkParticipant.metadata);
      this.remoteParticipants.set(lkParticipant.identity, participant);
      this.emit("participantJoined", participant);
      for (const publication of lkParticipant.trackPublications.values()) {
        if (!publication.track) continue;
        const track = new RemoteTrack(publication.track, trackKindFromSource(publication.source));
        this.remoteTrackWrappers.set(publication.track, track);
        participant.tracks.push(track);
        this.emit("trackSubscribed", track, participant);
      }
    }
  }
  async connect(endpoint, token, iceServers) {
    this.setConnectionState("connecting");
    try {
      await this.lkRoom.connect(endpoint, token, iceServers ? { rtcConfig: { iceServers } } : void 0);
      this.localParticipant._setIdentity(this.lkRoom.localParticipant.identity);
      this.bootstrapExistingParticipants();
      this.setConnectionState("connected");
    } catch (error) {
      this.setConnectionState("failed");
      throw mapConnectError(error);
    }
  }
  async disconnect() {
    this.intentionalDisconnect = true;
    await this.lkRoom.disconnect();
  }
  async enableCamera(enabled) {
    try {
      const publication = await this.lkRoom.localParticipant.setCameraEnabled(enabled);
      return publication?.track ? this.trackFromPublication(publication) : void 0;
    } catch (error) {
      throw toMediaError(error, "camera");
    }
  }
  async enableMicrophone(enabled) {
    try {
      const publication = await this.lkRoom.localParticipant.setMicrophoneEnabled(enabled);
      return publication?.track ? this.trackFromPublication(publication) : void 0;
    } catch (error) {
      throw toMediaError(error, "microphone");
    }
  }
  async enableScreenShare(enabled) {
    try {
      const publication = await this.lkRoom.localParticipant.setScreenShareEnabled(enabled);
      return publication?.track ? this.trackFromPublication(publication) : void 0;
    } catch (error) {
      throw toMediaError(error, "screenShare");
    }
  }
  trackFromPublication(publication) {
    const existing = this.localTrackWrappers.get(publication);
    if (existing) return existing;
    const track = new LocalTrack(publication.track, trackKindFromSource(publication.source));
    this.localTrackWrappers.set(publication, track);
    return track;
  }
  async publish(track) {
    try {
      await this.lkRoom.localParticipant.publishTrack(track.mediaStreamTrack);
    } catch (error) {
      throw new RTCError("MEDIA_ERROR", "Failed to publish track", error);
    }
  }
  async unpublish(track) {
    await this.lkRoom.localParticipant.unpublishTrack(track.mediaStreamTrack);
  }
  async sendData(payload) {
    try {
      await this.lkRoom.localParticipant.publishData(payload);
    } catch (error) {
      throw new RTCError("PERMISSION_DENIED", "Failed to send data \u2014 check the token grants publishData", error);
    }
  }
  async getDevices(kind) {
    const infos = await Room.getLocalDevices(kind, true);
    return infos.map((info) => ({ deviceId: info.deviceId, label: info.label, kind: info.kind }));
  }
  async setDevice(kind, deviceId) {
    await this.lkRoom.switchActiveDevice(kind, deviceId);
  }
};
function assertLocalTrack(publication) {
  if (!publication.track) {
    throw new RTCError("MEDIA_ERROR", "Track publication has no local track");
  }
  return publication.track;
}

// src/internal/telemetry/connection-id.ts
function generateConnectionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `conn_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  let id = "";
  for (let i = 0; i < 32; i++) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return `conn_${id}`;
}

// src/internal/telemetry/platform.ts
function detectPlatform() {
  if (typeof navigator === "undefined") {
    return { platform: "unknown", browser: "unknown" };
  }
  const ua = navigator.userAgent ?? "";
  let browser = "unknown";
  if (/edg\//i.test(ua)) browser = "edge";
  else if (/firefox|fxios/i.test(ua)) browser = "firefox";
  else if (/chrome|crios/i.test(ua)) browser = "chrome";
  else if (/safari/i.test(ua)) browser = "safari";
  let platform = "web";
  if (/android/i.test(ua)) platform = "android";
  else if (/iphone|ipad|ipod/i.test(ua)) platform = "ios";
  const connection = navigator.connection;
  const networkType = typeof connection?.effectiveType === "string" ? connection.effectiveType : void 0;
  return { platform, browser, networkType };
}

// src/internal/telemetry/telemetry-client.ts
function createTelemetryClient(options) {
  const connectionId = generateConnectionId();
  if (!options.enabled || !options.telemetryUrl) {
    return { connectionId, send: () => {
    } };
  }
  return new HttpTelemetryClient(connectionId, options);
}
var HttpTelemetryClient = class {
  constructor(connectionId, options) {
    this.connectionId = connectionId;
    this.options = options;
  }
  send(type, data = {}) {
    const body = {
      connectionId: this.connectionId,
      type,
      data: { sdkVersion: this.options.sdkVersion, ...detectPlatform(), ...data }
    };
    try {
      fetch(`${this.options.telemetryUrl}/v1/telemetry/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.token}` },
        body: JSON.stringify(body),
        keepalive: true
      }).then((res) => {
        if (!res.ok) {
          this.options.logger.debug("telemetry event rejected", type, res.status);
        }
      }).catch((error) => {
        this.options.logger.debug("telemetry event failed", type, error.message);
      });
    } catch (error) {
      this.options.logger.debug("telemetry send threw synchronously", type, error.message);
    }
  }
};

// src/version.ts
var SDK_VERSION = "0.1.0";

// src/room.ts
var _Room = class _Room extends TypedEventEmitter {
  /** @internal use `client.join(roomId)` — the telemetry client defaults to a no-op so tests/advanced setups can construct a Room directly without wiring one up. */
  constructor(adapter, roomId, logger, telemetry = createTelemetryClient({ enabled: false, token: "", sdkVersion: SDK_VERSION, logger })) {
    super();
    this.reconnectCount = 0;
    this.adapter = adapter;
    this.roomId = roomId;
    this.logger = logger;
    this.telemetry = telemetry;
    this.connectionId = telemetry.connectionId;
    this.localParticipant = adapter.localParticipant;
    this.wireAdapterEvents();
  }
  get remoteParticipants() {
    return Array.from(this.adapter.remoteParticipants.values());
  }
  get connectionState() {
    return this.adapter.connectionState;
  }
  wireAdapterEvents() {
    let prevState = this.adapter.connectionState;
    this.adapter.on("connectionStateChanged", (state) => {
      this.emit("connectionStateChanged", state);
      if (state === "connected") {
        if (prevState === "reconnecting") {
          this.reconnectCount++;
          this.telemetry.send("reconnected");
          this.emit("reconnected");
        } else {
          this.telemetry.send("connected");
          this.emit("connected");
        }
        this.startStatsMonitor();
      } else if (state === "reconnecting" && prevState !== "reconnecting") {
        this.telemetry.send("reconnecting");
        this.emit("reconnecting");
      } else if (state === "disconnected" || state === "failed") {
        this.stopStatsMonitor();
        this.telemetry.send(state === "failed" ? "connection_failed" : "disconnected");
        this.emit("disconnected");
        if (state === "failed") {
          const error = new RTCError("CONNECTION_FAILED", "Connection failed after exhausting reconnect attempts");
          this.telemetry.send("error", { code: error.code, message: error.message });
          this.emit("error", error);
        }
      }
      prevState = state;
    });
    this.adapter.on("participantJoined", (participant) => {
      this.telemetry.send("participant_joined", { participantIdentity: participant.identity });
      this.emit("participantJoined", participant);
    });
    this.adapter.on("participantLeft", (participant) => {
      this.telemetry.send("participant_left", { participantIdentity: participant.identity });
      this.emit("participantLeft", participant);
    });
    this.adapter.on("trackPublished", (kind, participant) => this.emit("trackPublished", kind, participant));
    this.adapter.on("trackUnpublished", (kind, participant) => this.emit("trackUnpublished", kind, participant));
    this.adapter.on("trackSubscribed", (track, participant) => this.emit("trackSubscribed", track, participant));
    this.adapter.on("trackUnsubscribed", (track, participant) => this.emit("trackUnsubscribed", track, participant));
    this.adapter.on("trackMuted", (kind, participant) => this.emit("trackMuted", kind, participant));
    this.adapter.on("trackUnmuted", (kind, participant) => this.emit("trackUnmuted", kind, participant));
    this.adapter.on("localTrackPublished", (track) => {
      this.telemetry.send("track_published", { kind: track.kind });
      this.emit("localTrackPublished", track);
    });
    this.adapter.on("localTrackUnpublished", (track) => {
      this.telemetry.send("track_unpublished", { kind: track.kind });
      this.emit("localTrackUnpublished", track);
    });
    this.adapter.on("dataReceived", (payload, participant) => this.emit("dataReceived", payload, participant));
    this.adapter.on("mediaError", (error) => {
      this.logger.warn("media device error", error.message);
      const rtcError = new RTCError("MEDIA_ERROR", error.message, error);
      this.telemetry.send("error", { code: rtcError.code, message: rtcError.message });
      this.emit("error", rtcError);
    });
  }
  /**
   * A safe, non-secret diagnostic snapshot for support/debugging (Phase 9
   * spec §12) — never a token, never a secret, safe to print or attach to
   * a bug report as-is.
   */
  getDiagnostics() {
    const { platform, browser } = detectPlatform();
    return {
      connectionState: this.connectionState,
      iceConnectionState: void 0,
      signalingState: void 0,
      reconnectCount: this.reconnectCount,
      sdkVersion: SDK_VERSION,
      platform,
      browser
    };
  }
  /**
   * Live media-quality stats for every published and subscribed track —
   * RTT, jitter, packet loss, bitrate, codec, resolution/fps, plus the
   * SFU's own connection-quality read. See `ConnectionStats` for why this
   * is separate from `getDiagnostics()`.
   *
   * Safe to call at any time, including before anything has been
   * published or subscribed — `local`/`remote` are simply empty then, not
   * an error.
   */
  async getConnectionStats() {
    const localTracks = this.localParticipant.tracks;
    const remoteTracks = this.remoteParticipants.flatMap((participant) => participant.tracks);
    const [local, remote] = await Promise.all([
      Promise.all(localTracks.map((track) => track.getStats())),
      Promise.all(remoteTracks.map((track) => track.getStats()))
    ]);
    return {
      connectionState: this.connectionState,
      connectionQuality: this.adapter.getConnectionQuality(),
      local: local.filter((stats) => stats !== void 0),
      remote: remote.filter((stats) => stats !== void 0)
    };
  }
  /**
   * Polls `getConnectionStats()` on an interval and reports it as
   * telemetry, so the dashboard's RTC view (spec §23) has numbers to show
   * without every developer wiring this up themselves. Best-effort like
   * every other telemetry event here: a failure is swallowed rather than
   * surfaced, since a stats-collection hiccup is not a reason to disrupt
   * the call it's describing.
   */
  startStatsMonitor() {
    if (this.statsTimer) {
      return;
    }
    this.statsTimer = setInterval(() => {
      this.getConnectionStats().then((stats) => this.telemetry.send("stats", stats)).catch(() => {
      });
    }, _Room.STATS_INTERVAL_MS);
  }
  stopStatsMonitor() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = void 0;
    }
  }
  /** Captures and publishes the camera in one call. Resolves to the published track. */
  async enableCamera() {
    return this.adapter.enableCamera(true);
  }
  /** Stops publishing and releases the camera. */
  async disableCamera() {
    await this.adapter.enableCamera(false);
  }
  /** Captures and publishes the microphone in one call. Resolves to the published track. */
  async enableMicrophone() {
    return this.adapter.enableMicrophone(true);
  }
  /** Stops publishing and releases the microphone. */
  async disableMicrophone() {
    await this.adapter.enableMicrophone(false);
  }
  /** Captures and publishes a screen share in one call. */
  async enableScreenShare() {
    return this.adapter.enableScreenShare(true);
  }
  async disableScreenShare() {
    await this.adapter.enableScreenShare(false);
  }
  /** Publishes a track created via `client.createCameraTrack()` et al. */
  async publish(track) {
    await this.adapter.publish(track);
  }
  async unpublish(track) {
    await this.adapter.unpublish(track);
  }
  /** Switches the active camera without republishing. */
  async setCameraDevice(deviceId) {
    await this.adapter.setDevice("videoinput", deviceId);
  }
  /** Switches the active microphone without republishing. */
  async setMicrophoneDevice(deviceId) {
    await this.adapter.setDevice("audioinput", deviceId);
  }
  /**
   * Switches the audio output ("speaker") device for this room's remote
   * audio elements — Phase 11 addition. Not universally supported (Safari
   * lacks `HTMLMediaElement.setSinkId`); throws `DEVICE_NOT_FOUND` on
   * browsers that don't implement it, rather than silently no-op-ing.
   */
  async setSpeakerDevice(deviceId) {
    if (typeof document !== "undefined") {
      const probe = document.createElement("audio");
      if (typeof probe.setSinkId !== "function") {
        throw new RTCError("DEVICE_NOT_FOUND", "This browser doesn't support selecting an audio output device (no setSinkId)");
      }
    }
    await this.adapter.setDevice("audiooutput", deviceId);
  }
  /**
   * Sends a small payload to all participants (or specific ones, if the
   * underlying SFU adapter supports targeting). Needs the token's
   * `publishData` grant — throws PERMISSION_DENIED otherwise.
   */
  async sendData(payload) {
    const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : new Uint8Array(payload);
    await this.adapter.sendData(bytes);
  }
  /** Leaves the room, stops local tracks, and closes the underlying connection. */
  async leave() {
    this.stopStatsMonitor();
    await this.adapter.disconnect();
  }
};
/**
 * How often the stats monitor samples and reports. Frequent enough that
 * a dashboard viewing "now" isn't looking at stale numbers; infrequent
 * enough that it isn't a meaningful load on the telemetry endpoint
 * across a call with dozens of participants each doing this.
 */
_Room.STATS_INTERVAL_MS = 5e3;
var Room2 = _Room;

// src/client.ts
var defaultAdapterFactory = (logger, autoReconnect) => new LiveKitAdapter(logger, autoReconnect);
var RTCClient = class {
  /**
   * @internal use `createRTCClient(config)` instead. Second param only
   * exists so tests can inject a fake SFUAdapter without a real
   * browser/WebRTC stack — not part of the public config.
   */
  constructor(config, adapterFactory = defaultAdapterFactory) {
    this.config = config;
    this.logger = createLogger(config.logLevel);
    this.adapterFactory = adapterFactory;
  }
  /**
   * Joins the room this client's token was minted for. `roomId` must match
   * that room — passing a different one throws `ROOM_NOT_FOUND` immediately,
   * before attempting any connection.
   */
  async join(roomId) {
    assertTokenMatchesRoom(this.config.token, roomId);
    this.logger.info("joining room", roomId);
    const telemetry = createTelemetryClient({
      enabled: this.config.telemetry,
      telemetryUrl: this.config.telemetryUrl,
      token: this.config.token,
      sdkVersion: SDK_VERSION,
      logger: this.logger
    });
    telemetry.send("connection_started");
    const adapter = this.adapterFactory(this.logger, this.config.autoReconnect);
    const room = new Room2(adapter, roomId, this.logger, telemetry);
    try {
      await adapter.connect(this.config.endpoint, this.config.token, this.config.iceServers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof RTCError ? error.code : "CONNECTION_FAILED";
      telemetry.send("error", { code, message });
      telemetry.send("connection_failed");
      throw error;
    }
    this.currentRoom = room;
    return room;
  }
  /** Leaves the most recently joined room, if any. Equivalent to calling `.leave()` on that `Room`. */
  async leave() {
    await this.currentRoom?.leave();
    this.currentRoom = void 0;
  }
  /** Captures a camera track without joining/publishing — pair with `room.publish(track)`. */
  async createCameraTrack(deviceId) {
    return createCameraTrack(deviceId);
  }
  /** Captures a microphone track without joining/publishing — pair with `room.publish(track)`. */
  async createMicrophoneTrack(deviceId) {
    return createMicrophoneTrack(deviceId);
  }
  /** Captures a screen-share track without joining/publishing — pair with `room.publish(track)`. */
  async createScreenShareTrack() {
    return createScreenShareTrack();
  }
  /** Lists available devices. Labels are populated only once permission has been granted at least once. */
  async getDevices(kind) {
    return listDevices(kind);
  }
  /**
   * Subscribes to device connect/disconnect (Phase 11 addition) — e.g. a
   * USB webcam being plugged in or unplugged. Returns an unsubscribe
   * function. A no-op (immediately-callable unsubscribe) in environments
   * without `navigator.mediaDevices` rather than throwing, since this is
   * an optional convenience, not a required capability.
   */
  onDeviceChange(callback) {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return () => {
      };
    }
    navigator.mediaDevices.addEventListener("devicechange", callback);
    return () => navigator.mediaDevices.removeEventListener("devicechange", callback);
  }
  /** Switches the active camera on the currently joined room. */
  async setCamera(deviceId) {
    if (!this.currentRoom) {
      throw new RTCError("CONNECTION_FAILED", "setCamera() requires an active room \u2014 call join() first");
    }
    await this.currentRoom.setCameraDevice(deviceId);
  }
  /** Switches the active microphone on the currently joined room. */
  async setMicrophone(deviceId) {
    if (!this.currentRoom) {
      throw new RTCError("CONNECTION_FAILED", "setMicrophone() requires an active room \u2014 call join() first");
    }
    await this.currentRoom.setMicrophoneDevice(deviceId);
  }
  /** Safe diagnostic snapshot of the currently joined room — see `Room.getDiagnostics()`. */
  getDiagnostics() {
    if (!this.currentRoom) {
      throw new RTCError("CONNECTION_FAILED", "getDiagnostics() requires an active room \u2014 call join() first");
    }
    return this.currentRoom.getDiagnostics();
  }
};
function createRTCClient(config) {
  const resolved = validateConfig(config);
  return new RTCClient(resolved);
}

// src/browser-support.ts
function getBrowserSupportDetails() {
  const missing = [];
  if (typeof RTCPeerConnection === "undefined") missing.push("RTCPeerConnection");
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) missing.push("navigator.mediaDevices.getUserMedia");
  if (typeof WebSocket === "undefined") missing.push("WebSocket");
  return { supported: missing.length === 0, missing };
}
function isBrowserSupported() {
  return getBrowserSupportDetails().supported;
}

export { LocalParticipant, LocalTrack, Participant, RTCClient, RTCError, RemoteParticipant, RemoteTrack, Room2 as Room, Track, createRTCClient, getBrowserSupportDetails, isBrowserSupported, isRTCError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map