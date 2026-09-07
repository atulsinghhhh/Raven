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

// src/internal/devices/enumerate.ts
async function listDevices(kind) {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    throw new RTCError(
      "NOT_SUPPORTED",
      "Device enumeration is not available in this environment (no navigator.mediaDevices)"
    );
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => !kind || device.kind === kind).map((device) => ({
    deviceId: device.deviceId,
    label: device.label,
    kind: device.kind
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

// src/internal/media/errors.ts
function toMediaError(error, kind) {
  const name = errorName(error);
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new RTCError(
        permissionDeniedCode(kind),
        `Permission to use the ${label(kind)} was denied`,
        error
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return new RTCError("DEVICE_NOT_FOUND", `No ${label(kind)} device matched`, error);
    case "NotReadableError":
      return new RTCError(
        "MEDIA_ERROR",
        `The ${label(kind)} is already in use by another application`,
        error
      );
    case "AbortError":
      return new RTCError("MEDIA_ERROR", `Capturing the ${label(kind)} was aborted`, error);
    case "TypeError":
      return new RTCError("MEDIA_ERROR", `Invalid ${label(kind)} capture constraints`, error);
    default:
      return new RTCError("MEDIA_ERROR", `Could not access the ${label(kind)}`, error);
  }
}
function errorName(error) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name;
  }
  if (error && typeof error === "object" && typeof error.name === "string") {
    return error.name;
  }
  return void 0;
}
function label(kind) {
  return kind === "screenShare" ? "screen" : kind;
}
function permissionDeniedCode(kind) {
  if (kind === "camera") return "CAMERA_PERMISSION_DENIED";
  if (kind === "microphone") return "MICROPHONE_PERMISSION_DENIED";
  return "PERMISSION_DENIED";
}

// src/internal/telemetry/rtc-stats.ts
function rawStatsFromReport(report, wanted) {
  const codecs = /* @__PURE__ */ new Map();
  const remoteInbound = [];
  const rtpEntries = [];
  report.forEach((entry) => {
    const stats = entry;
    switch (stats.type) {
      case "codec":
        if (typeof stats.id === "string" && typeof stats.mimeType === "string") {
          codecs.set(stats.id, stats.mimeType);
        }
        break;
      case "remote-inbound-rtp":
        remoteInbound.push(stats);
        break;
      case wanted:
        rtpEntries.push(stats);
        break;
    }
  });
  return rtpEntries.map((rtp) => toRawStats(rtp, wanted, codecs, remoteInbound));
}
function toRawStats(rtp, direction, codecs, remoteInbound) {
  const kind = rtp.kind ?? rtp.mediaType;
  const sample = {
    type: kind === "audio" ? "audio" : kind === "video" ? "video" : void 0,
    // `RTCStats.timestamp` is a DOMHighResTimeStamp relative to the time
    // origin, and `normalizeTrackStats` only ever uses it as a delta
    // against a previous sample, so its epoch does not matter. Falling
    // back to Date.now() keeps the delta usable in the rare case the
    // browser omitted it.
    timestamp: typeof rtp.timestamp === "number" ? rtp.timestamp : Date.now()
  };
  if (typeof rtp.jitter === "number") sample.jitter = rtp.jitter;
  if (typeof rtp.frameWidth === "number") sample.frameWidth = rtp.frameWidth;
  if (typeof rtp.frameHeight === "number") sample.frameHeight = rtp.frameHeight;
  if (typeof rtp.framesPerSecond === "number") sample.framesPerSecond = rtp.framesPerSecond;
  const mimeType = rtp.mimeType ?? (rtp.codecId ? codecs.get(rtp.codecId) : void 0);
  if (mimeType) sample.mimeType = mimeType;
  if (direction === "outbound-rtp") {
    if (typeof rtp.bytesSent === "number") sample.bytesSent = rtp.bytesSent;
    if (typeof rtp.packetsSent === "number") sample.packetsSent = rtp.packetsSent;
    const feedback = remoteInbound.find((remote) => rtp.id && remote.localId === rtp.id) ?? remoteInbound.find((remote) => rtp.ssrc !== void 0 && remote.ssrc === rtp.ssrc);
    if (feedback) {
      if (typeof feedback.roundTripTime === "number") sample.roundTripTime = feedback.roundTripTime;
      if (typeof feedback.packetsLost === "number") sample.packetsLost = feedback.packetsLost;
      if (sample.jitter === void 0 && typeof feedback.jitter === "number") {
        sample.jitter = feedback.jitter;
      }
    }
    return sample;
  }
  if (typeof rtp.bytesReceived === "number") sample.bytesReceived = rtp.bytesReceived;
  if (typeof rtp.packetsReceived === "number") sample.packetsReceived = rtp.packetsReceived;
  if (typeof rtp.packetsLost === "number") sample.packetsLost = rtp.packetsLost;
  return sample;
}
async function connectionRoundTripTimeMs(connection) {
  const report = await connection.getStats();
  let rttSeconds;
  report.forEach((entry) => {
    const stats = entry;
    if (stats.type !== "candidate-pair") {
      return;
    }
    if (stats.state !== "succeeded" || stats.nominated !== true) {
      return;
    }
    if (typeof stats.currentRoundTripTime === "number") {
      rttSeconds = stats.currentRoundTripTime;
    }
  });
  return rttSeconds === void 0 ? void 0 : rttSeconds * 1e3;
}

// src/internal/media/native-track.ts
var NativeTrackDelegate = class {
  constructor(mediaStreamTrack) {
    this.attachedElements = /* @__PURE__ */ new Set();
    this.mediaStreamTrack = mediaStreamTrack;
  }
  get mediaStream() {
    if (!this.stream && typeof MediaStream !== "undefined") {
      this.stream = new MediaStream([this.mediaStreamTrack]);
    }
    return this.stream;
  }
  attach(element) {
    const target = element ?? this.createElement();
    const stream = this.mediaStream;
    if (stream) {
      target.srcObject = stream;
    }
    target.autoplay = true;
    if (target instanceof HTMLVideoElement) {
      target.playsInline = true;
    }
    this.attachedElements.add(target);
    return target;
  }
  detach(element) {
    if (element) {
      element.srcObject = null;
      this.attachedElements.delete(element);
      return element;
    }
    const detached = Array.from(this.attachedElements);
    for (const attached of detached) {
      attached.srcObject = null;
    }
    this.attachedElements.clear();
    return detached;
  }
  /**
   * Swaps the track this delegate wraps.
   *
   * Called after `replaceTrack` on the sender succeeds, so that
   * `attach()`ed elements and `mediaStreamTrack` describe what is actually
   * being sent rather than the track that was replaced.
   */
  swapMediaStreamTrack(next) {
    this.mediaStreamTrack = next;
    this.stream = typeof MediaStream !== "undefined" ? new MediaStream([next]) : void 0;
    const stream = this.stream;
    if (!stream) {
      return;
    }
    for (const element of this.attachedElements) {
      element.srcObject = stream;
    }
  }
  createElement() {
    if (typeof document === "undefined") {
      throw new Error("attach() without an element requires a DOM");
    }
    return document.createElement(this.mediaStreamTrack.kind === "video" ? "video" : "audio");
  }
};
var NativeLocalTrackDelegate = class extends NativeTrackDelegate {
  constructor() {
    super(...arguments);
    this.muted = false;
  }
  get isMuted() {
    return this.muted;
  }
  /** @internal called by the adapter once the track is attached to a sender. */
  setSender(sender) {
    this.sender = sender;
  }
  /**
   * Mutes by disabling the underlying track rather than removing it.
   *
   * `track.enabled = false` makes the browser send silence or black
   * frames — the RTP stream continues, the transceiver stays, and
   * unmuting is instant. Stopping the track instead would release the
   * device (turning off the camera light, which users read as "off") but
   * would then need a fresh `getUserMedia` and a renegotiation to undo.
   *
   * The SFU is told separately, via signaling, so it can stop forwarding
   * the silence to every subscriber instead of paying to relay it.
   */
  async mute() {
    this.mediaStreamTrack.enabled = false;
    this.muted = true;
    return void 0;
  }
  async unmute() {
    this.mediaStreamTrack.enabled = true;
    this.muted = false;
    return void 0;
  }
  /**
   * Replaces the outgoing track without renegotiating.
   *
   * This is what makes Raven Effects work mid-call: `RTCRtpSender.replaceTrack`
   * swaps the source of an established stream, so a processed video track
   * takes over from the raw camera with no offer/answer and no
   * interruption to anyone else in the room.
   */
  async replaceTrack(track, _userProvidedTrack) {
    if (this.sender) {
      await this.sender.replaceTrack(track);
    }
    this.swapMediaStreamTrack(track);
    if (this.muted) {
      track.enabled = false;
    }
    return void 0;
  }
  /**
   * Send-side stats for this track.
   *
   * Returns an array for video, because a simulcast sender reports one
   * `outbound-rtp` per encoding layer — `LocalTrack.getStats()` picks the
   * highest-resolution one. `undefined` when there is no sender yet: an
   * unpublished track has no send statistics, and reporting zeroes would
   * claim it was sending nothing rather than not sending at all.
   */
  async getSenderStats() {
    if (!this.sender) {
      return void 0;
    }
    const report = await this.sender.getStats();
    const samples = rawStatsFromReport(report, "outbound-rtp");
    if (samples.length === 0) {
      return void 0;
    }
    return samples.length === 1 ? samples[0] : samples;
  }
};
var NativeRemoteTrackDelegate = class extends NativeTrackDelegate {
  constructor(mediaStreamTrack, receiver) {
    super(mediaStreamTrack);
    this.publisherMuted = false;
    this.receiver = receiver;
  }
  get isMuted() {
    return this.publisherMuted;
  }
  /** @internal set from the SFU's `track.muted` / `track.unmuted` events. */
  setPublisherMuted(muted) {
    this.publisherMuted = muted;
  }
  async getReceiverStats() {
    const report = await this.receiver.getStats();
    const [sample] = rawStatsFromReport(report, "inbound-rtp");
    return sample;
  }
};

// src/internal/media/capture.ts
var DEFAULT_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};
var DEFAULT_VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 }
};
var VIDEO_PROFILES = {
  "360p": { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } },
  "480p": { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  "720p": { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  "1080p": { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
};
async function createCameraTrack(options = {}) {
  const constraints = {
    ...DEFAULT_VIDEO_CONSTRAINTS,
    ...options.profile ? VIDEO_PROFILES[options.profile] : {},
    ...options.facingMode ? { facingMode: options.facingMode } : {},
    ...options.deviceId ? { deviceId: { exact: options.deviceId } } : {},
    ...options.constraints
  };
  const stream = await getUserMedia({ video: constraints, audio: false }, "camera");
  return trackFromStream(stream, "camera");
}
async function createMicrophoneTrack(options = {}) {
  const constraints = {
    ...DEFAULT_AUDIO_CONSTRAINTS,
    ...options.deviceId ? { deviceId: { exact: options.deviceId } } : {},
    ...options.constraints
  };
  const stream = await getUserMedia({ audio: constraints, video: false }, "microphone");
  return trackFromStream(stream, "microphone");
}
async function createScreenShareTrack() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new RTCError(
      "NOT_SUPPORTED",
      "Screen sharing is not available on this platform (no getDisplayMedia)"
    );
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (error) {
    throw toMediaError(error, "screenShare");
  }
  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) {
    throw new RTCError("MEDIA_ERROR", "Screen capture returned no video track");
  }
  return new LocalTrack(new NativeLocalTrackDelegate(videoTrack), "screenShare");
}
async function getUserMedia(constraints, kind) {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new RTCError(
      "NOT_SUPPORTED",
      "Media capture is not available in this environment (no navigator.mediaDevices)"
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    throw toMediaError(error, kind);
  }
}
function trackFromStream(stream, kind) {
  const [track] = kind === "microphone" ? stream.getAudioTracks() : stream.getVideoTracks();
  if (!track) {
    throw new RTCError("MEDIA_ERROR", `Capture returned no ${kind} track`);
  }
  return new LocalTrack(new NativeLocalTrackDelegate(track), kind);
}

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

// src/internal/signaling/protocol.ts
var ClientMessageType = {
  ROOM_JOIN: "room.join",
  ROOM_LEAVE: "room.leave",
  SDP_ANSWER: "sdp.answer",
  SDP_OFFER: "sdp.offer",
  ICE_CANDIDATE: "ice.candidate",
  TRACK_MUTE: "track.mute",
  /**
   * Declares what a track being published is *of*.
   *
   * Necessary because WebRTC carries no such concept and a page cannot
   * choose the `MediaStream` or `MediaStreamTrack` id the SDP will carry
   * — both are read-only. Without this the SFU can only infer source from
   * codec kind, which cannot tell a screen share from a camera.
   */
  TRACK_PUBLISH: "track.publish",
  SUBSCRIPTION_UPDATE: "subscription.update",
  PING: "ping"
};
var ServerMessageType = {
  ROOM_JOINED: "room.joined",
  PARTICIPANT_JOINED: "participant.joined",
  PARTICIPANT_LEFT: "participant.left",
  TRACK_PUBLISHED: "track.published",
  TRACK_UNPUBLISHED: "track.unpublished",
  TRACK_MUTED: "track.muted",
  TRACK_UNMUTED: "track.unmuted",
  SDP_OFFER: "sdp.offer",
  SDP_ANSWER: "sdp.answer",
  ICE_CANDIDATE: "ice.candidate",
  CONNECTION_STATE: "connection.state",
  ERROR: "error"};
var FATAL_ERROR_CODES = /* @__PURE__ */ new Set([
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "ROOM_NOT_FOUND",
  "PERMISSION_DENIED"
]);

// src/internal/signaling/signaling-client.ts
var OPEN_TIMEOUT_MS = 1e4;
var JOIN_TIMEOUT_MS = 15e3;
var RECONNECT_BASE_MS = 300;
var RECONNECT_MAX_MS = 1e4;
var RECONNECT_MAX_ATTEMPTS = 12;
var SignalingClient = class extends TypedEventEmitter {
  constructor(options) {
    super();
    this.reconnectAttempts = 0;
    this.closedByCaller = false;
    this.joined = false;
    this.options = options;
    this.token = options.token;
    this.logger = options.logger;
  }
  get isJoined() {
    return this.joined;
  }
  /**
   * Opens the socket and joins the room.
   *
   * Resolves once `room.joined` arrives — not merely once the socket
   * opens. A caller that got a resolved promise on socket-open would then
   * have to wait for an event to know whether it was actually in the room,
   * which is the same waiting with an extra step.
   */
  async connect() {
    this.closedByCaller = false;
    return this.openAndJoin();
  }
  async openAndJoin() {
    const socket = await this.openSocket();
    this.socket = socket;
    return this.join(socket);
  }
  openSocket() {
    const url = this.buildUrl();
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(new RTCError("SIGNALING_ERROR", "Could not open a signaling connection", error));
        return;
      }
      const timeout = setTimeout(() => {
        socket.close();
        reject(new RTCError("TIMEOUT", `Signaling connection to ${this.options.endpoint} timed out`));
      }, OPEN_TIMEOUT_MS);
      socket.onopen = () => {
        clearTimeout(timeout);
        this.logger.debug("signaling socket open");
        resolve(socket);
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(
          new RTCError(
            "NETWORK_ERROR",
            `Could not reach the signaling endpoint at ${this.options.endpoint}`
          )
        );
      };
    });
  }
  join(socket) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new RTCError("TIMEOUT", "The server did not confirm the room join"));
      }, JOIN_TIMEOUT_MS);
      let settled = false;
      const settle = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };
      socket.onmessage = (event) => {
        const message = this.parse(event.data);
        if (!message) {
          return;
        }
        if (!settled) {
          if (message.type === ServerMessageType.ROOM_JOINED) {
            const payload = {
              roomId: message.roomId,
              participants: message.participants,
              rtcServer: message.rtcServer,
              region: message.region
            };
            this.joined = true;
            this.reconnectAttempts = 0;
            this.logger.info(
              "joined room",
              message.roomId,
              message.rtcServer ? `via ${message.rtcServer}` : ""
            );
            settle(() => resolve(payload));
            this.emit("joined", payload);
            return;
          }
          if (message.type === ServerMessageType.ERROR) {
            settle(() => reject(this.toError(message.code, message.message)));
            return;
          }
        }
        this.handleMessage(message);
      };
      socket.onclose = (event) => {
        this.joined = false;
        settle(
          () => reject(
            new RTCError(
              "SIGNALING_ERROR",
              `The signaling connection closed before the room was joined (code ${event.code})`
            )
          )
        );
        this.handleClose(event);
      };
      socket.onerror = () => {
      };
      this.send({
        type: ClientMessageType.ROOM_JOIN,
        roomId: this.options.roomId,
        region: this.options.region
      });
    });
  }
  handleMessage(message) {
    if (message.type === ServerMessageType.ERROR) {
      const error = this.toError(message.code, message.message);
      this.logger.warn("signaling error", message.code, message.message);
      if (FATAL_ERROR_CODES.has(message.code)) {
        this.closedByCaller = true;
        this.socket?.close();
        this.emit("failed", error);
        return;
      }
    }
    this.emit("message", message);
  }
  handleClose(event) {
    if (this.closedByCaller) {
      this.emit("closed");
      return;
    }
    if (!this.options.autoReconnect) {
      this.emit(
        "failed",
        new RTCError("NETWORK_ERROR", `The signaling connection closed (code ${event.code})`)
      );
      return;
    }
    const authFailed = event.code === 4001;
    void this.scheduleReconnect(authFailed);
  }
  async scheduleReconnect(refreshFirst) {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.emit(
        "failed",
        new RTCError(
          "CONNECTION_FAILED",
          `Could not re-establish signaling after ${RECONNECT_MAX_ATTEMPTS} attempts`
        )
      );
      return;
    }
    this.reconnectAttempts++;
    this.emit("reconnecting");
    if (refreshFirst || this.reconnectAttempts === 1) {
      await this.tryRefreshToken();
    }
    const backoff = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    const delay = Math.random() * backoff;
    this.logger.info(
      `signaling reconnect attempt ${this.reconnectAttempts} in ${Math.round(delay)}ms`
    );
    this.reconnectTimer = setTimeout(() => {
      void this.openAndJoin().catch((error) => {
        this.logger.warn("signaling reconnect failed", error.message);
        void this.scheduleReconnect(false);
      });
    }, delay);
  }
  async tryRefreshToken() {
    if (!this.options.refreshToken) {
      return;
    }
    try {
      this.token = await this.options.refreshToken();
      this.logger.debug("rtc token refreshed");
    } catch (error) {
      this.logger.warn("rtc token refresh failed", error.message);
    }
  }
  /** Replaces the token used by future reconnects (spec §21). */
  setToken(token) {
    this.token = token;
  }
  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.logger.debug("dropping signaling message, socket not open", message.type);
      return;
    }
    this.socket.send(JSON.stringify(message));
  }
  /** Leaves the room and closes the socket. Suppresses reconnection. */
  close() {
    this.closedByCaller = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = void 0;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: ClientMessageType.ROOM_LEAVE });
      this.socket.close(1e3, "client left");
    }
    this.joined = false;
  }
  buildUrl() {
    const base = this.options.endpoint.replace(/\/$/, "");
    return `${base}?token=${encodeURIComponent(this.token)}`;
  }
  parse(data) {
    if (typeof data !== "string") {
      this.logger.warn("ignoring non-text signaling frame");
      return void 0;
    }
    try {
      return JSON.parse(data);
    } catch {
      this.logger.warn("ignoring unparseable signaling frame");
      return void 0;
    }
  }
  toError(code, message) {
    switch (code) {
      case "INVALID_TOKEN":
        return new RTCError("INVALID_TOKEN", message);
      case "TOKEN_EXPIRED":
        return new RTCError("TOKEN_EXPIRED", message);
      case "ROOM_NOT_FOUND":
        return new RTCError("ROOM_NOT_FOUND", message);
      case "UNAUTHORIZED":
      case "PERMISSION_DENIED":
        return new RTCError("PERMISSION_DENIED", message);
      case "ROOM_FULL":
      case "NO_RTC_CAPACITY":
      case "RTC_SERVER_UNREACHABLE":
        return new RTCError("CONNECTION_FAILED", message);
      case "RATE_LIMITED":
        return new RTCError("NETWORK_ERROR", message);
      default:
        return new RTCError("SIGNALING_ERROR", message);
    }
  }
};

// src/internal/sfu/raven-adapter.ts
var DATA_CHANNEL_LABEL = "raven-data";
var MAX_DATA_PAYLOAD_BYTES = 64 * 1024;
var ICE_GATHER_HINT_MS = 0;
function trackKindFromSource(source, kind) {
  switch (source) {
    case "camera":
      return "camera";
    case "microphone":
      return "microphone";
    case "screenShare":
      return "screenShare";
    default:
      return kind === "audio" ? "microphone" : "camera";
  }
}
var RavenAdapter = class extends TypedEventEmitter {
  constructor(logger, autoReconnect) {
    super();
    this.remoteParticipants = /* @__PURE__ */ new Map();
    this.iceServers = [];
    this._connectionState = "disconnected";
    this.intentionalDisconnect = false;
    /** Published tracks by kind, so `enableCamera(false)` knows what to stop. */
    this.published = /* @__PURE__ */ new Map();
    /** Subscribed tracks by `publisherId/trackId`. */
    this.subscribed = /* @__PURE__ */ new Map();
    /**
     * What the server has told us each participant publishes, before the
     * media itself arrives. `ontrack` and `track.published` race, and either
     * can be first — so both paths consult this and the subscription is
     * completed by whichever arrives second.
     */
    this.announcedTracks = /* @__PURE__ */ new Map();
    /** Tracks whose media arrived before the announcement. */
    this.pendingMedia = /* @__PURE__ */ new Map();
    /** Publishes deferred by glare, retried once the server's offer is answered. */
    this.deferredPublishes = [];
    this.logger = logger;
    this.autoReconnect = autoReconnect;
    this.localParticipant = new LocalParticipant("");
  }
  get connectionState() {
    return this._connectionState;
  }
  /**
   * The SFU's read on this connection's health.
   *
   * Currently `'unknown'` unless the SFU has reported a failed state.
   *
   * This is deliberate and it is a known gap, not an oversight. The
   * previous adapter returned LiveKit's server-computed verdict, which had
   * a vantage point a client cannot have: the SFU sees loss and jitter on
   * every leg of the room, not just this one. Raven's SFU does not yet
   * compute an equivalent. Returning a client-side guess dressed up as a
   * server verdict would be exactly the fabricated metric spec §19
   * forbids, so it returns "unknown" until the SFU can answer honestly.
   * `room.getConnectionStats()` returns real per-track numbers in the
   * meantime.
   */
  getConnectionQuality() {
    if (this.sfuPeerState === "failed" || this._connectionState === "failed") {
      return "lost";
    }
    return "unknown";
  }
  /** Diagnostics the LiveKit adapter could not provide (see `Room.getDiagnostics()`). */
  getIceConnectionState() {
    return this.pc?.iceConnectionState;
  }
  getSignalingState() {
    return this.pc?.signalingState;
  }
  /** The SFU's own view, which can disagree with the local one — and that disagreement is the useful part. */
  getRemoteConnectionState() {
    return { iceState: this.sfuIceState, peerState: this.sfuPeerState };
  }
  async getConnectionRoundTripTimeMs() {
    return this.pc ? connectionRoundTripTimeMs(this.pc) : void 0;
  }
  // --- Connection --------------------------------------------------------
  async connect(endpoint, token, iceServers) {
    this.iceServers = iceServers ?? [];
    this.setConnectionState("connecting");
    const roomId = roomIdFromToken(token);
    const signaling = new SignalingClient({
      endpoint,
      token,
      roomId,
      autoReconnect: this.autoReconnect,
      logger: this.logger
    });
    this.signaling = signaling;
    signaling.on("message", (message) => void this.handleSignalingMessage(message));
    signaling.on("reconnecting", () => {
      this.setConnectionState("reconnecting");
      this.teardownPeerConnection();
    });
    signaling.on("joined", (payload) => void this.handleJoined(payload));
    signaling.on("failed", (error) => {
      this.logger.error("signaling failed", error.message);
      this.setConnectionState("failed");
    });
    signaling.on("closed", () => {
      this.setConnectionState(this.intentionalDisconnect ? "disconnected" : "failed");
    });
    try {
      const joined = await signaling.connect();
      this.localParticipant._setIdentity(participantIdFromToken(token));
      await this.handleJoined(joined);
    } catch (error) {
      this.setConnectionState("failed");
      throw error instanceof RTCError ? error : new RTCError("CONNECTION_FAILED", "Could not join the room", error);
    }
  }
  /**
   * Applies the room state the server reported at join.
   *
   * Called both on first join and after every reconnect. On a reconnect
   * the participant list is authoritative and the previous one is
   * discarded — a participant who left during the outage must not linger,
   * and one who joined during it must appear.
   */
  async handleJoined(payload) {
    this.logger.debug(
      "room state at join",
      `${payload.participants.length} participant(s)`,
      payload.rtcServer ? `on ${payload.rtcServer}` : ""
    );
    const present = new Set(payload.participants.map((participant) => participant.id));
    for (const [id, participant] of this.remoteParticipants) {
      if (!present.has(id)) {
        this.remoteParticipants.delete(id);
        this.emit("participantLeft", participant);
      }
    }
    for (const entry of payload.participants) {
      let participant = this.remoteParticipants.get(entry.id);
      if (!participant) {
        participant = new RemoteParticipant(entry.id);
        this.remoteParticipants.set(entry.id, participant);
        this.emit("participantJoined", participant);
      }
      for (const track of entry.tracks ?? []) {
        this.announceTrack(entry.id, track);
      }
    }
  }
  async handleSignalingMessage(message) {
    switch (message.type) {
      case ServerMessageType.ROOM_JOINED:
        await this.handleJoined({
          roomId: message.roomId,
          participants: message.participants,
          rtcServer: message.rtcServer,
          region: message.region
        });
        return;
      case ServerMessageType.SDP_OFFER:
        await this.handleOffer(message.sdp);
        return;
      case ServerMessageType.SDP_ANSWER:
        await this.handleAnswer(message.sdp);
        return;
      case ServerMessageType.ICE_CANDIDATE:
        await this.handleRemoteCandidate(message);
        return;
      case ServerMessageType.PARTICIPANT_JOINED: {
        const existing = this.remoteParticipants.get(message.participant.id);
        if (existing) {
          return;
        }
        const participant = new RemoteParticipant(message.participant.id);
        this.remoteParticipants.set(participant.identity, participant);
        this.emit("participantJoined", participant);
        return;
      }
      case ServerMessageType.PARTICIPANT_LEFT: {
        const participant = this.remoteParticipants.get(message.participant.id);
        if (!participant) {
          return;
        }
        this.remoteParticipants.delete(participant.identity);
        for (const [key, subscription] of this.subscribed) {
          if (subscription.participantId === participant.identity) {
            this.subscribed.delete(key);
            this.emit("trackUnsubscribed", subscription.track, participant);
          }
        }
        this.emit("participantLeft", participant);
        return;
      }
      case ServerMessageType.TRACK_PUBLISHED:
        this.announceTrack(message.participantId, message.track);
        return;
      case ServerMessageType.TRACK_UNPUBLISHED: {
        const key = subscriptionKey(message.participantId, message.trackId);
        this.announcedTracks.delete(key);
        this.pendingMedia.delete(key);
        const subscription = this.subscribed.get(key);
        const participant = this.remoteParticipants.get(message.participantId);
        if (subscription && participant) {
          this.subscribed.delete(key);
          this.emit("trackUnpublished", subscription.track.kind, participant);
          this.emit("trackUnsubscribed", subscription.track, participant);
        }
        return;
      }
      case ServerMessageType.TRACK_MUTED:
      case ServerMessageType.TRACK_UNMUTED: {
        const muted = message.type === ServerMessageType.TRACK_MUTED;
        const key = subscriptionKey(message.participantId, message.trackId);
        const subscription = this.subscribed.get(key);
        const participant = this.remoteParticipants.get(message.participantId);
        if (!subscription || !participant) {
          return;
        }
        subscription.delegate.setPublisherMuted(muted);
        this.emit(muted ? "trackMuted" : "trackUnmuted", subscription.track.kind, participant);
        return;
      }
      case ServerMessageType.CONNECTION_STATE:
        this.sfuIceState = message.iceState;
        this.sfuPeerState = message.peerState;
        this.logger.debug("sfu connection state", message.iceState, message.peerState);
        return;
      case ServerMessageType.ERROR:
        if (message.code === "NEGOTIATION_GLARE") {
          this.logger.debug("publish deferred by glare; will retry after the next offer");
          return;
        }
        this.emit("mediaError", new Error(message.message));
        return;
      default:
        return;
    }
  }
  // --- Negotiation -------------------------------------------------------
  ensurePeerConnection() {
    if (this.pc) {
      return this.pc;
    }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      this.signaling?.send({
        type: ClientMessageType.ICE_CANDIDATE,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? void 0,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? void 0,
        usernameFragment: event.candidate.usernameFragment ?? void 0
      });
    };
    pc.onconnectionstatechange = () => {
      this.logger.debug("peer connection state", pc.connectionState);
      switch (pc.connectionState) {
        case "connected":
          this.setConnectionState("connected");
          break;
        case "failed":
          this.setConnectionState(this.autoReconnect ? "reconnecting" : "failed");
          break;
      }
    };
    pc.ontrack = (event) => this.handleIncomingTrack(event);
    pc.ondatachannel = (event) => {
      if (event.channel.label !== DATA_CHANNEL_LABEL) {
        return;
      }
      this.attachDataChannel(event.channel);
    };
    return pc;
  }
  async handleOffer(sdp) {
    const pc = this.ensurePeerConnection();
    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling?.send({
        type: ClientMessageType.SDP_ANSWER,
        sdp: pc.localDescription?.sdp ?? answer.sdp ?? ""
      });
      this.flushDeferredPublishes();
    } catch (error) {
      this.logger.error("failed to answer offer", error.message);
      this.emit("mediaError", new Error("Could not answer the server's offer"));
    }
  }
  async handleAnswer(sdp) {
    if (!this.pc) {
      return;
    }
    try {
      await this.pc.setRemoteDescription({ type: "answer", sdp });
    } catch (error) {
      this.logger.error("failed to apply answer", error.message);
    }
  }
  async handleRemoteCandidate(message) {
    if (!this.pc) {
      return;
    }
    try {
      await this.pc.addIceCandidate({
        candidate: message.candidate,
        sdpMid: message.sdpMid,
        sdpMLineIndex: message.sdpMLineIndex,
        usernameFragment: message.usernameFragment
      });
    } catch (error) {
      this.logger.debug("ignoring ICE candidate", error.message);
    }
  }
  flushDeferredPublishes() {
    const pending = this.deferredPublishes;
    this.deferredPublishes = [];
    for (const retry of pending) {
      retry();
    }
  }
  /**
   * Offers, so the server learns about a newly added track.
   *
   * Needed only when adding a track created a new transceiver — which
   * happens on the first publish of each kind. Later publishes of the same
   * kind reuse the transceiver and ride the server's next offer.
   */
  async negotiatePublish() {
    const pc = this.pc;
    const signaling = this.signaling;
    if (!pc || !signaling) {
      return;
    }
    if (pc.signalingState !== "stable") {
      this.logger.debug("deferring publish negotiation until stable");
      this.deferredPublishes.push(() => void this.negotiatePublish());
      return;
    }
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitTick();
      signaling.send({
        type: ClientMessageType.SDP_OFFER,
        sdp: pc.localDescription?.sdp ?? offer.sdp ?? ""
      });
    } catch (error) {
      this.logger.error("publish negotiation failed", error.message);
      throw new RTCError("MEDIA_ERROR", "Could not negotiate the published track", error);
    }
  }
  // --- Incoming media ----------------------------------------------------
  /**
   * Matches an arriving track to what signaling said about it.
   *
   * The SFU forwards each subscription carrying the *publisher's* track id
   * as the SDP `msid` track id, which is what makes attribution possible
   * without a side-channel. `ontrack` and `track.published` race, so this
   * completes the subscription only when both halves are present and
   * parks whichever arrived first.
   *
   * # Why the id comes from the SDP rather than from the track
   *
   * `RTCTrackEvent.track.id` is **not** the remote track id. Chrome mints
   * a fresh local id for a received track and ignores what the `msid`
   * said; the id in `a=msid:<stream> <track>` is the remote one. Matching
   * on `event.track.id` therefore never matched anything, and — because
   * the unmatched track was parked as "media arrived early" — it failed
   * silently, as a subscription that simply never completed rather than
   * as an error. Reading the `msid` is the standards-defined way to get
   * the id the remote peer chose.
   */
  handleIncomingTrack(event) {
    const [stream] = event.streams;
    const trackId = this.remoteTrackIdFor(event) ?? event.track.id;
    const announcement = this.findAnnouncementForTrack(trackId);
    if (!announcement) {
      this.logger.debug(
        "media arrived before its announcement",
        `resolved=${trackId}`,
        `local=${event.track.id}`,
        `stream=${stream?.id ?? "none"}`,
        `mid=${event.transceiver?.mid ?? "none"}`,
        `announced=[${Array.from(this.announcedTracks.values()).map((entry) => `${entry.participantId}:${entry.track.trackId}`).join(", ")}]`
      );
      this.pendingMedia.set(pendingKey(trackId), {
        stream: stream ?? new MediaStream([event.track]),
        track: event.track,
        receiver: event.receiver
      });
      return;
    }
    this.completeSubscription(
      announcement.participantId,
      announcement.track,
      event.track,
      event.receiver
    );
  }
  /**
   * The remote track id for an arriving track, read from the remote SDP.
   *
   * Located by the transceiver's `mid` rather than by scanning every
   * `a=msid:` line, because a participant publishing both a camera and a
   * screen share has two video m-sections and picking the wrong one would
   * label a screen share as somebody's face.
   *
   * Returns undefined when the SDP does not say — an `msid`-less offer, or
   * a transceiver with no mid yet — so the caller can fall back rather
   * than guess.
   */
  remoteTrackIdFor(event) {
    const mid = event.transceiver?.mid;
    const sdp = this.pc?.remoteDescription?.sdp;
    if (!mid || !sdp) {
      return void 0;
    }
    const sections = sdp.split(/\r?\nm=/).slice(1);
    for (const section of sections) {
      const lines = section.split(/\r?\n/);
      if (!lines.some((line) => line.trim() === `a=mid:${mid}`)) {
        continue;
      }
      const msid = lines.find((line) => line.startsWith("a=msid:"));
      const trackId = msid?.slice("a=msid:".length).trim().split(/\s+/)[1];
      return trackId && trackId.length > 0 ? trackId : void 0;
    }
    return void 0;
  }
  findAnnouncementForTrack(trackId) {
    for (const announcement of this.announcedTracks.values()) {
      if (announcement.track.trackId === trackId) {
        return announcement;
      }
    }
    return void 0;
  }
  announceTrack(participantId, track) {
    const key = subscriptionKey(participantId, track.trackId);
    this.announcedTracks.set(key, { participantId, track });
    this.logger.debug("track announced", `${participantId}:${track.trackId}`, track.kind, track.source);
    const participant = this.remoteParticipants.get(participantId);
    if (participant) {
      this.emit("trackPublished", trackKindFromSource(track.source, track.kind), participant);
    }
    const pending = this.pendingMedia.get(pendingKey(track.trackId));
    if (pending) {
      this.pendingMedia.delete(pendingKey(track.trackId));
      this.completeSubscription(participantId, track, pending.track, pending.receiver);
    }
  }
  completeSubscription(participantId, serverTrack, mediaStreamTrack, receiver) {
    const participant = this.remoteParticipants.get(participantId);
    if (!participant) {
      this.logger.debug("track for an unknown participant", participantId);
      return;
    }
    const key = subscriptionKey(participantId, serverTrack.trackId);
    if (this.subscribed.has(key)) {
      return;
    }
    const delegate = new NativeRemoteTrackDelegate(mediaStreamTrack, receiver);
    delegate.setPublisherMuted(serverTrack.muted);
    const kind = trackKindFromSource(serverTrack.source, serverTrack.kind);
    const track = new RemoteTrack(delegate, kind);
    this.subscribed.set(key, { track, delegate, participantId, trackId: serverTrack.trackId });
    participant.tracks.push(track);
    this.emit("trackSubscribed", track, participant);
    mediaStreamTrack.onended = () => {
      const subscription = this.subscribed.get(key);
      if (!subscription) {
        return;
      }
      this.subscribed.delete(key);
      const index = participant.tracks.indexOf(subscription.track);
      if (index !== -1) {
        participant.tracks.splice(index, 1);
      }
      this.emit("trackUnsubscribed", subscription.track, participant);
    };
  }
  // --- Publishing --------------------------------------------------------
  async enableCamera(enabled) {
    return enabled ? this.publishKind("camera", () => createCameraTrack()) : this.unpublishKind("camera");
  }
  async enableMicrophone(enabled) {
    return enabled ? this.publishKind("microphone", () => createMicrophoneTrack()) : this.unpublishKind("microphone");
  }
  async enableScreenShare(enabled) {
    return enabled ? this.publishKind("screenShare", () => createScreenShareTrack()) : this.unpublishKind("screenShare");
  }
  async publishKind(kind, capture) {
    const existing = this.published.get(kind);
    if (existing) {
      await existing.track.unmute();
      this.signaling?.send({
        type: ClientMessageType.TRACK_MUTE,
        trackId: existing.trackId,
        muted: false
      });
      return existing.track;
    }
    const track = await capture();
    await this.publish(track);
    return track;
  }
  async unpublishKind(kind) {
    const existing = this.published.get(kind);
    if (!existing) {
      return void 0;
    }
    await this.unpublish(existing.track);
    return void 0;
  }
  async publish(track) {
    const pc = this.ensurePeerConnection();
    const delegate = track["delegate"];
    if (!(delegate instanceof NativeLocalTrackDelegate)) {
      throw new RTCError(
        "MEDIA_ERROR",
        "This track was not created by the Raven SDK and cannot be published"
      );
    }
    const stream = typeof MediaStream !== "undefined" ? new MediaStream([track.mediaStreamTrack]) : void 0;
    let sender;
    try {
      sender = stream ? pc.addTrack(track.mediaStreamTrack, stream) : pc.addTrack(track.mediaStreamTrack);
    } catch (error) {
      throw new RTCError("MEDIA_ERROR", "Could not add the track to the connection", error);
    }
    const source = declaredSourceFor(track.kind);
    if (source) {
      this.signaling?.send({
        type: ClientMessageType.TRACK_PUBLISH,
        trackId: track.mediaStreamTrack.id,
        source
      });
    }
    delegate.setSender(sender);
    await this.applySimulcast(sender, track.kind);
    this.published.set(track.kind, {
      track,
      delegate,
      sender,
      trackId: track.mediaStreamTrack.id
    });
    if (!this.localParticipant.tracks.includes(track)) {
      this.localParticipant.tracks.push(track);
    }
    track.mediaStreamTrack.onended = () => {
      void this.unpublish(track).catch(() => void 0);
    };
    await this.negotiatePublish();
    this.emit("localTrackPublished", track);
  }
  async unpublish(track) {
    const entry = this.published.get(track.kind);
    if (!entry || entry.track !== track) {
      return;
    }
    this.published.delete(track.kind);
    const index = this.localParticipant.tracks.indexOf(track);
    if (index !== -1) {
      this.localParticipant.tracks.splice(index, 1);
    }
    entry.delegate.setSender(void 0);
    try {
      this.pc?.removeTrack(entry.sender);
    } catch (error) {
      this.logger.debug("removeTrack failed", error.message);
    }
    track.mediaStreamTrack.stop();
    await this.negotiatePublish();
    this.emit("localTrackUnpublished", track);
  }
  /**
   * Configures simulcast on a video sender (spec §15).
   *
   * Three spatial layers, each a quarter of the previous one's pixel count
   * — the standard ladder, and the one browsers implement well. Applied
   * via `setParameters` after `addTrack` rather than through
   * `addTransceiver`'s `sendEncodings`, because the transceiver may
   * already exist from the SFU's offer and re-adding it would renegotiate
   * for nothing.
   *
   * Audio is left alone: there is no spatial layering to do, and Opus
   * already adapts its own bitrate.
   */
  async applySimulcast(sender, kind) {
    if (kind === "microphone" || sender.track?.kind !== "video") {
      return;
    }
    if (kind === "screenShare") {
      return;
    }
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings || parameters.encodings.length === 0) {
        return;
      }
      parameters.encodings = [
        { rid: "low", scaleResolutionDownBy: 4, maxBitrate: 15e4 },
        { rid: "medium", scaleResolutionDownBy: 2, maxBitrate: 5e5 },
        { rid: "high", scaleResolutionDownBy: 1, maxBitrate: 15e5 }
      ];
      await sender.setParameters(parameters);
    } catch (error) {
      this.logger.debug("simulcast not applied", error.message);
    }
  }
  // --- Data channel ------------------------------------------------------
  attachDataChannel(channel) {
    this.dataChannel = channel;
    channel.binaryType = "arraybuffer";
    channel.onmessage = (event) => {
      const payload = toUint8Array(event.data);
      if (payload) {
        this.emit("dataReceived", payload, void 0);
      }
    };
    channel.onclose = () => {
      if (this.dataChannel === channel) {
        this.dataChannel = void 0;
      }
    };
  }
  async sendData(payload) {
    if (payload.byteLength > MAX_DATA_PAYLOAD_BYTES) {
      throw new RTCError(
        "MEDIA_ERROR",
        `Data payload is ${payload.byteLength} bytes, over the ${MAX_DATA_PAYLOAD_BYTES}-byte limit`
      );
    }
    const channel = this.dataChannel ?? this.openDataChannel();
    if (!channel) {
      throw new RTCError("CONNECTION_FAILED", "sendData() requires an active connection");
    }
    if (channel.readyState !== "open") {
      throw new RTCError("CONNECTION_FAILED", "The data channel is not open yet");
    }
    try {
      channel.send(payload);
    } catch (error) {
      throw new RTCError("PERMISSION_DENIED", "Could not send data \u2014 check the token grants publishData", error);
    }
  }
  /**
   * Opens the data channel on demand.
   *
   * Not opened at connect: a channel costs an SCTP association, and most
   * calls never send data. Created by the client rather than the server
   * because the client is the side that knows it wants one.
   */
  openDataChannel() {
    if (!this.pc) {
      return void 0;
    }
    const channel = this.pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.attachDataChannel(channel);
    return channel;
  }
  // --- Devices -----------------------------------------------------------
  async getDevices(kind) {
    return listDevices(kind);
  }
  async setDevice(kind, deviceId) {
    switch (kind) {
      case "videoinput":
        return this.replaceDevice("camera", () => createCameraTrack({ deviceId }));
      case "audioinput":
        return this.replaceDevice("microphone", () => createMicrophoneTrack({ deviceId }));
      case "audiooutput":
        return this.setAudioOutput(deviceId);
      default:
        throw new RTCError("DEVICE_NOT_FOUND", `Unknown device kind "${String(kind)}"`);
    }
  }
  /**
   * Switches the device behind a published track without renegotiating.
   *
   * `replaceTrack` is what makes this seamless: the transceiver, the SSRC,
   * and every subscriber's view of the track are untouched, so nobody
   * else in the room sees anything happen.
   */
  async replaceDevice(kind, capture) {
    const entry = this.published.get(kind);
    if (!entry) {
      return;
    }
    const replacement = await capture();
    const previous = entry.track.mediaStreamTrack;
    await entry.delegate.replaceTrack(replacement.mediaStreamTrack);
    previous.stop();
  }
  /**
   * Points this room's remote audio at a different output device.
   *
   * `setSinkId` is per-element, so this walks the elements each remote
   * audio track is attached to. Safari has no `setSinkId` at all;
   * `Room.setSpeakerDevice()` checks for that and throws before reaching
   * here, so an unsupported browser gets a clear error rather than a
   * silent no-op.
   */
  async setAudioOutput(deviceId) {
    const failures = [];
    for (const subscription of this.subscribed.values()) {
      if (subscription.track.kind === "camera" || subscription.track.kind === "screenShare") {
        continue;
      }
      for (const element of subscription.track.detach()) {
        const withSink = element;
        try {
          await withSink.setSinkId?.(deviceId);
        } catch (error) {
          failures.push(error);
        }
        subscription.track.attach(element);
      }
    }
    if (failures.length > 0) {
      throw new RTCError("DEVICE_NOT_FOUND", "Could not switch the audio output device", failures[0]);
    }
  }
  // --- Teardown ----------------------------------------------------------
  async disconnect() {
    this.intentionalDisconnect = true;
    for (const entry of this.published.values()) {
      entry.track.mediaStreamTrack.stop();
    }
    this.published.clear();
    this.localParticipant.tracks.length = 0;
    this.signaling?.close();
    this.teardownPeerConnection();
    this.remoteParticipants.clear();
    this.subscribed.clear();
    this.announcedTracks.clear();
    this.pendingMedia.clear();
    this.setConnectionState("disconnected");
  }
  teardownPeerConnection() {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
      }
      this.dataChannel = void 0;
    }
    if (!this.pc) {
      return;
    }
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.ontrack = null;
    this.pc.ondatachannel = null;
    try {
      this.pc.close();
    } catch {
    }
    this.pc = void 0;
  }
  setConnectionState(state) {
    if (this._connectionState === state) {
      return;
    }
    this._connectionState = state;
    this.emit("connectionStateChanged", state);
  }
};
function subscriptionKey(participantId, trackId) {
  return `${participantId}/${trackId}`;
}
function pendingKey(trackId) {
  return `media:${trackId}`;
}
function declaredSourceFor(kind) {
  switch (kind) {
    case "camera":
    case "microphone":
    case "screenShare":
      return kind;
    default:
      return void 0;
  }
}
function toUint8Array(data) {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (isArrayBufferLike(data)) {
    return new Uint8Array(data);
  }
  return void 0;
}
function isArrayBufferLike(value) {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]";
}
function waitTick() {
  return new Promise((resolve) => setTimeout(resolve, ICE_GATHER_HINT_MS));
}
function roomIdFromToken(token) {
  const claims = decodeClaims(token);
  const roomId = claims?.rid;
  if (typeof roomId !== "string" || roomId.length === 0) {
    throw new RTCError("INVALID_TOKEN", "RTC token does not name a room");
  }
  return roomId;
}
function participantIdFromToken(token) {
  const claims = decodeClaims(token);
  return typeof claims?.sub === "string" ? claims.sub : "";
}
function decodeClaims(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return void 0;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return void 0;
  }
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
   * A safe, non-secret diagnostic snapshot for support and debugging.
   *
   * Synchronous and cheap by design — safe to call from anywhere, any
   * time, including from an error handler. Live media stats are a
   * separate, `async` call; see `getConnectionStats()`.
   */
  getDiagnostics() {
    const { platform, browser } = detectPlatform();
    const remote = this.adapter.getRemoteConnectionState?.() ?? {};
    return {
      connectionState: this.connectionState,
      iceConnectionState: this.adapter.getIceConnectionState?.(),
      signalingState: this.adapter.getSignalingState?.(),
      remoteIceConnectionState: remote.iceState,
      remotePeerConnectionState: remote.peerState,
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
  /**
   * Resolves once the media connection is actually established.
   *
   * # Why this exists
   *
   * `client.join()` resolves when the **control plane** has admitted
   * you: the room is joined, you know who else is in it, and you can
   * publish. The media connection completes a moment later, after ICE and
   * DTLS — so `connectionState` is `'connecting'` for a short window
   * after `join()` returns. That is the honest shape of an SFU
   * connection, and it is why `'connected'` is an event rather than a
   * postcondition of joining.
   *
   * Most callers need none of this: `enableCamera()` and
   * `enableMicrophone()` work during that window, and the `connected`
   * event is the right thing to drive a UI from. This is for code that
   * genuinely has to block — a test, or a flow that must not proceed
   * until media is live.
   *
   * Resolves immediately if already connected. Rejects on `'failed'`, and
   * on timeout, rather than resolving with a connection that is not there.
   *
   * A subscriber joining a room where nobody is publishing may legitimately
   * stay `'connecting'`: with no tracks on either side there is nothing to
   * negotiate, so waiting here would time out on a connection that is not
   * broken. Drive a UI from the `connected` event instead of blocking on
   * this when that is possible.
   */
  waitUntilConnected(timeoutMs = 15e3) {
    if (this.connectionState === "connected") {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const settle = (fn) => {
        clearTimeout(timer);
        this.off("connectionStateChanged", onState);
        fn();
      };
      const onState = (state) => {
        if (state === "connected") {
          settle(resolve);
        } else if (state === "failed") {
          settle(() => reject(new RTCError("CONNECTION_FAILED", "The connection failed while waiting for it")));
        }
      };
      const timer = setTimeout(() => {
        settle(
          () => reject(
            new RTCError(
              "CONNECTION_FAILED",
              `Still ${this.connectionState} after ${timeoutMs}ms \u2014 the media connection did not establish`
            )
          )
        );
      }, timeoutMs);
      this.on("connectionStateChanged", onState);
    });
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
var Room = _Room;

// src/client.ts
var defaultAdapterFactory = (logger, autoReconnect) => new RavenAdapter(logger, autoReconnect);
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
    const room = new Room(adapter, roomId, this.logger, telemetry);
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
    return createCameraTrack(deviceId ? { deviceId } : {});
  }
  /** Captures a microphone track without joining/publishing — pair with `room.publish(track)`. */
  async createMicrophoneTrack(deviceId) {
    return createMicrophoneTrack(deviceId ? { deviceId } : {});
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

export { LocalParticipant, LocalTrack, Participant, RTCClient, RTCError, RemoteParticipant, RemoteTrack, Room, Track, createRTCClient, getBrowserSupportDetails, isBrowserSupported, isRTCError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map