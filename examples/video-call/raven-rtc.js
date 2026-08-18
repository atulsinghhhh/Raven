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
      'config.endpoint is required \u2014 the "livekitUrl" field from the same token-mint response as config.token'
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
    autoReconnect: config.autoReconnect ?? true
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
};
var RemoteTrack = class extends Track {
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
   * @internal Only the SFU adapter calls this, once, right after connect()
   * resolves — the local participant's identity isn't known until the
   * server confirms it, but the constructor runs before that.
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
   * RoomEvent.ParticipantConnected/TrackSubscribed only fire for
   * participants/tracks that arrive *after* our listeners are attached —
   * livekit-client has already populated room.remoteParticipants (and each
   * participant's already-subscribed tracks) by the time connect() resolves
   * for anyone who joined before us. Without this, a participant who joined
   * first would never appear on a participant who joins second.
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

// src/room.ts
var Room2 = class extends TypedEventEmitter {
  constructor(adapter, roomId, logger) {
    super();
    this.adapter = adapter;
    this.roomId = roomId;
    this.logger = logger;
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
        this.emit(prevState === "reconnecting" ? "reconnected" : "connected");
      } else if (state === "reconnecting" && prevState !== "reconnecting") {
        this.emit("reconnecting");
      } else if (state === "disconnected" || state === "failed") {
        this.emit("disconnected");
        if (state === "failed") {
          this.emit(
            "error",
            new RTCError("CONNECTION_FAILED", "Connection failed after exhausting reconnect attempts")
          );
        }
      }
      prevState = state;
    });
    this.adapter.on("participantJoined", (participant) => this.emit("participantJoined", participant));
    this.adapter.on("participantLeft", (participant) => this.emit("participantLeft", participant));
    this.adapter.on("trackPublished", (kind, participant) => this.emit("trackPublished", kind, participant));
    this.adapter.on("trackUnpublished", (kind, participant) => this.emit("trackUnpublished", kind, participant));
    this.adapter.on("trackSubscribed", (track, participant) => this.emit("trackSubscribed", track, participant));
    this.adapter.on("trackUnsubscribed", (track, participant) => this.emit("trackUnsubscribed", track, participant));
    this.adapter.on("localTrackPublished", (track) => this.emit("localTrackPublished", track));
    this.adapter.on("localTrackUnpublished", (track) => this.emit("localTrackUnpublished", track));
    this.adapter.on("dataReceived", (payload, participant) => this.emit("dataReceived", payload, participant));
    this.adapter.on("mediaError", (error) => {
      this.logger.warn("media device error", error.message);
      this.emit("error", new RTCError("MEDIA_ERROR", error.message, error));
    });
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
  /** Captures and publishes a screen share in one call (see docs/sdk.md#screen-sharing). */
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
   * Sends a small application payload to all (or, per the underlying SFU's
   * own targeting, specific) participants. Requires the token's
   * `publishData` grant — throws PERMISSION_DENIED otherwise. See
   * docs/sdk.md#data (Phase 6 spec §21 — kept intentionally minimal).
   */
  async sendData(payload) {
    const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : new Uint8Array(payload);
    await this.adapter.sendData(bytes);
  }
  /** Leaves the room, stops local tracks, and closes the underlying connection. */
  async leave() {
    await this.adapter.disconnect();
  }
};

// src/client.ts
var defaultAdapterFactory = (logger, autoReconnect) => new LiveKitAdapter(logger, autoReconnect);
var RTCClient = class {
  /**
   * @internal use `createRTCClient(config)` instead. The second parameter
   * exists only so unit tests can inject a fake SFUAdapter without a real
   * browser/WebRTC stack — never part of the public config shape.
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
    const adapter = this.adapterFactory(this.logger, this.config.autoReconnect);
    const room = new Room2(adapter, roomId, this.logger);
    await adapter.connect(this.config.endpoint, this.config.token, this.config.iceServers);
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
};
function createRTCClient(config) {
  const resolved = validateConfig(config);
  return new RTCClient(resolved);
}

export { LocalParticipant, LocalTrack, Participant, RTCClient, RTCError, RemoteParticipant, RemoteTrack, Room2 as Room, Track, createRTCClient, isRTCError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map