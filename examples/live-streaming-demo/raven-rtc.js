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
      roomId: typeof json?.rid === "string" ? json.rid : void 0,
      roomName: typeof json?.rnm === "string" ? json.rnm : void 0,
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
    throw new RTCError("INVALID_TOKEN", "config.token is required; the RTC token from your backend");
  }
  if (!config.endpoint || typeof config.endpoint !== "string") {
    throw new RTCError(
      "INVALID_TOKEN",
      'config.endpoint is required; the "endpoint" field from the same token-mint response as config.token'
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
function assertTokenMatchesRoom(token, room) {
  const { roomId, roomName } = decodeTokenPayload(token);
  if (!roomId && !roomName) {
    return;
  }
  if (room === roomId || room === roomName) {
    return;
  }
  const minted = roomName ?? roomId;
  throw new RTCError("ROOM_NOT_FOUND", `This token was minted for room "${minted}", not "${room}"`);
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
  /** The underlying native track, for the rare occasion you need to go deeper. */
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
  /** Stops the underlying device capture. Publish state belongs to Room.unpublish(). */
  stop() {
    this.mediaStreamTrack.stop();
  }
  /**
   * Where Livqeno Effects (`@ravenkash/effects`) plugs in. The chain is
   * Camera → Livqeno Video Track → Effects Pipeline → Processed Video Track →
   * Livqeno RTC.
   *
   * Runs `pipeline` against this track's live camera feed and, if the track
   * is already published, swaps the sender's `MediaStreamTrack` in place
   * through the adapter's `replaceTrack()`. No renegotiation, no reconnect,
   * audio and the rest of the room untouched. Camera only for now; screen
   * share and microphone aren't supported.
   *
   * Can't run the pipeline on this device (no WebGL2, Canvas2D or
   * captureStream)? It falls back to the original track on its own. The
   * call keeps working either way.
   */
  async attachEffects(pipeline) {
    if (this.kind !== "camera") {
      throw new RTCError("MEDIA_ERROR", `attachEffects() is only supported on camera tracks, not "${this.kind}".`);
    }
    if (!this.localDelegate.replaceTrack) {
      throw new RTCError(
        "MEDIA_ERROR",
        "This track cannot be swapped in place; the current adapter does not support replaceTrack()."
      );
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
  /** Goes back to the unmodified camera track and frees the pipeline's engine resources. */
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
   * Live send-side stats for this track: bitrate, packet loss, jitter, RTT
   * (audio only), resolution and fps (video only).
   *
   * You get `undefined`, not a zeroed-out object, when the adapter can't
   * supply them, either because the delegate has no `getSenderStats` or
   * because the underlying call resolved to nothing. The module doc covers
   * why that distinction matters.
   *
   * Call it periodically instead of once. `Room.getConnectionStats()` does,
   * every few seconds. Bitrate needs two samples to compute, so the first
   * call after a track starts always omits it.
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
  /** Live receive-side stats. `LocalTrack.getStats()` covers the shape and the caveats. */
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
      return new RTCError(permissionDeniedCode(kind), `Permission to use the ${label(kind)} was denied`, error);
    case "NotFoundError":
    case "OverconstrainedError":
      return new RTCError("DEVICE_NOT_FOUND", `No ${label(kind)} device matched`, error);
    case "NotReadableError":
      return new RTCError("MEDIA_ERROR", `The ${label(kind)} is already in use by another application`, error);
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
    // against a previous sample, so the epoch is irrelevant. Falling back
    // to Date.now() keeps the delta usable on the rare browser that omits
    // it.
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
   * Swaps out the track this delegate wraps.
   *
   * Called once `replaceTrack` on the sender has succeeded, so attached
   * elements and `mediaStreamTrack` describe what's actually going out
   * rather than the track we just replaced.
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
  /** @internal Called by the adapter once the track has a sender. */
  setSender(sender) {
    this.sender = sender;
  }
  /**
   * Mutes by disabling the underlying track, not by removing it.
   *
   * `track.enabled = false` has the browser send silence or black frames.
   * The RTP stream keeps going, the transceiver stays put, and unmuting is
   * instant. Stopping the track instead releases the device, which does
   * turn the camera light off (users read that as "off"), but undoing it
   * then costs a fresh `getUserMedia` and a renegotiation.
   *
   * We tell the SFU separately over signaling, so it can stop forwarding
   * the silence to every subscriber instead of paying to relay nothing.
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
   * This is the trick that makes Livqeno Effects work mid-call.
   * `RTCRtpSender.replaceTrack` swaps the source of an established stream,
   * so a processed video track takes over from the raw camera with no
   * offer/answer and nobody else in the room noticing.
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
   * Video gets an array, because a simulcast sender reports one
   * `outbound-rtp` per encoding layer, and `LocalTrack.getStats()` picks
   * the highest-resolution one. You get `undefined` when there's no sender
   * yet. An unpublished track has no send statistics, and reporting zeroes
   * would claim it was sending nothing when really it isn't sending.
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
  /** @internal Set from the SFU's `track.muted` / `track.unmuted` events. */
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
    throw new RTCError("NOT_SUPPORTED", "Screen sharing is not available on this platform (no getDisplayMedia)");
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
function createCustomTrack(mediaStreamTrack, options = {}) {
  if (!mediaStreamTrack || typeof mediaStreamTrack !== "object" || typeof mediaStreamTrack.kind !== "string") {
    throw new RTCError("MEDIA_ERROR", "createCustomTrack() needs a MediaStreamTrack");
  }
  if (mediaStreamTrack.kind !== "audio" && mediaStreamTrack.kind !== "video") {
    throw new RTCError("MEDIA_ERROR", `A MediaStreamTrack of kind "${mediaStreamTrack.kind}" cannot be published`);
  }
  if (mediaStreamTrack.readyState === "ended") {
    throw new RTCError("MEDIA_ERROR", "This MediaStreamTrack has already ended");
  }
  const source = options.source ?? (mediaStreamTrack.kind === "audio" ? "microphone" : "camera");
  if (source === "microphone" && mediaStreamTrack.kind !== "audio") {
    throw new RTCError("MEDIA_ERROR", "A microphone track has to be an audio MediaStreamTrack");
  }
  if (source !== "microphone" && mediaStreamTrack.kind !== "video") {
    throw new RTCError("MEDIA_ERROR", `A ${source} track has to be a video MediaStreamTrack`);
  }
  return new LocalTrack(new NativeLocalTrackDelegate(mediaStreamTrack), source);
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
  /** The RTC token's participant identity. Stable for the whole session. */
  get identity() {
    return this._identity;
  }
  /**
   * @internal Called once by the SFU adapter just after connect() resolves.
   * The constructor runs before the server has confirmed identity, so this
   * patches it in afterwards.
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
   * Needed because WebRTC has no such concept, and a page can't choose the
   * `MediaStream` or `MediaStreamTrack` id the SDP will carry; both are
   * read-only. Without this the SFU can only guess the source from codec
   * kind, and that can't tell a screen share from a camera.
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
  // Someone killed this credential on purpose. Retrying re-presents the
  // same dead token; the application's backend has to mint a new one.
  "TOKEN_REVOKED",
  "UNAUTHORIZED",
  "ROOM_NOT_FOUND",
  "PERMISSION_DENIED",
  // Reconnecting cannot help: the page's origin is not on the project's
  // allow-list, and that is changed in the dashboard, not by retrying.
  "ORIGIN_NOT_ALLOWED",
  // Not a credential problem, but just as terminal, and it belongs here
  // for the reconnect behaviour rather than the reason. The account is out
  // of included minutes: unlike RATE_LIMITED there is no window to wait
  // out, so backing off and retrying would spin against a wall until the
  // attempt budget ran out. A fresh token would not help either — the
  // limit is on the account, not the token.
  "USAGE_LIMIT_EXCEEDED"
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
   * Resolves when `room.joined` arrives, not when the socket opens. Resolve
   * on socket-open and the caller still has to sit waiting on an event to
   * find out whether they're actually in the room, which is the same wait
   * with an extra step bolted on.
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
        reject(new RTCError("NETWORK_ERROR", `Could not reach the signaling endpoint at ${this.options.endpoint}`));
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
            this.logger.info("joined room", message.roomId, message.rtcServer ? `via ${message.rtcServer}` : "");
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
      this.emit("failed", new RTCError("NETWORK_ERROR", `The signaling connection closed (code ${event.code})`));
      return;
    }
    const authFailed = event.code === 4001;
    void this.scheduleReconnect(authFailed);
  }
  async scheduleReconnect(refreshFirst) {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.emit(
        "failed",
        new RTCError("CONNECTION_FAILED", `Could not re-establish signaling after ${RECONNECT_MAX_ATTEMPTS} attempts`)
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
    this.logger.info(`signaling reconnect attempt ${this.reconnectAttempts} in ${Math.round(delay)}ms`);
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
  /** Leaves the room and closes the socket. No reconnect afterwards. */
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
      case "TOKEN_REVOKED":
        return new RTCError("TOKEN_REVOKED", message);
      // Surfaced as its own code rather than falling through to
      // SIGNALING_ERROR, so an application can tell "you are out of
      // minutes" from "signaling broke" and show a billing prompt instead
      // of a retry button.
      case "USAGE_LIMIT_EXCEEDED":
        return new RTCError("USAGE_LIMIT_EXCEEDED", message);
      case "ROOM_NOT_FOUND":
        return new RTCError("ROOM_NOT_FOUND", message);
      // ORIGIN_NOT_ALLOWED belongs here rather than in the default: the
      // token was valid, it was the page holding it that was not on the
      // project's allow-list. Letting it fall through to SIGNALING_ERROR
      // would bury the server's message naming the dashboard setting to
      // change.
      case "UNAUTHORIZED":
      case "PERMISSION_DENIED":
      case "ORIGIN_NOT_ALLOWED":
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
    /**
     * What this participant *wants* published, by kind.
     *
     * Desired state, deliberately not PeerConnection state. A reconnect
     * throws the PeerConnection away and with it every `RTCRtpSender`, but
     * the camera is still on and the developer never asked for it to stop —
     * so `sender` is the only field here that a replacement connection
     * invalidates, and `restoreLocalPublications()` refills it. Before this
     * split, a reconnect left the map holding senders belonging to a closed
     * connection: the tracks looked published, the new connection had no
     * transceivers for them, and the room went quiet.
     */
    this.published = /* @__PURE__ */ new Map();
    /** Subscribed tracks by `publisherId/trackId`. */
    this.subscribed = /* @__PURE__ */ new Map();
    /**
     * What the server says each participant publishes, ahead of the media
     * actually turning up. `ontrack` and `track.published` race and either
     * can win, so both paths check in here and whichever lands second
     * finishes the subscription.
     */
    this.announcedTracks = /* @__PURE__ */ new Map();
    /** Tracks whose media arrived before the announcement. */
    this.pendingMedia = /* @__PURE__ */ new Map();
    /**
     * Serializes everything that touches the signaling state machine —
     * remote offers, remote answers, our own offers, remote candidates.
     * See `enqueue()`.
     */
    this.negotiationChain = Promise.resolve();
    /** A local change is waiting for an offer to carry it. */
    this.negotiationNeeded = false;
    /** An offer task is already on the chain, so more requests coalesce into it. */
    this.negotiationScheduled = false;
    /** Callers of `dataChannelOpened()`, settled when the channel opens. */
    this.dataChannelWaiters = [];
    /** In-flight enable/disable per track kind. See `withKindLock()`. */
    this.kindOperations = /* @__PURE__ */ new Map();
    /**
     * Whether this page has asked for a data channel.
     *
     * Desired state, like `published`: the channel itself belongs to a
     * PeerConnection and does not survive a reconnect, but the intent does.
     */
    this.dataChannelWanted = false;
    /** Payloads accepted while the channel was still opening. */
    this.dataQueue = [];
    /**
     * Track ids we have already offered once to get onto the wire.
     *
     * `publishedTracksMissingFromSdp()` asks for one corrective offer per
     * published track and then stops asking, whatever the outcome. A
     * standing condition instead of a one-shot is a treadmill: if the
     * browser will not put our id in the description — a reused transceiver
     * whose msid it considers settled — then re-checking after every round
     * trip re-offers forever. Bounding it costs a mislabelled track source
     * in that corner; not bounding it costs the connection.
     */
    this.msidRefreshAttempted = /* @__PURE__ */ new Set();
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
   * Right now that's `'unknown'` unless the SFU has reported a failure.
   *
   * TODO: return a real verdict once the SFU computes one.
   *
   * Known gap, not an oversight. The old adapter passed through LiveKit's
   * server-computed verdict, which had a vantage point no client can get
   * near: the SFU sees loss and jitter on every leg of the room, not just
   * this one. Livqeno's SFU doesn't work out an equivalent yet. Dressing a
   * client-side guess up as a server verdict is precisely the fabricated
   * metric spec §19 rules out, so this says "unknown" until the SFU can
   * answer honestly. `room.getConnectionStats()` gives you real per-track
   * numbers in the meantime.
   */
  getConnectionQuality() {
    if (this.sfuPeerState === "failed" || this._connectionState === "failed") {
      return "lost";
    }
    return "unknown";
  }
  /** Diagnostics the LiveKit adapter never could give us (see `Room.getDiagnostics()`). */
  getIceConnectionState() {
    return this.pc?.iceConnectionState;
  }
  getSignalingState() {
    return this.pc?.signalingState;
  }
  /** The SFU's own view. It can disagree with the local one, and that disagreement is usually the interesting bit. */
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
      this.abortDataChannelWaiters("The connection failed before the data channel could open");
      this.setConnectionState("failed");
    });
    signaling.on("closed", () => {
      this.abortDataChannelWaiters("The connection closed before the data channel could open");
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
   * Applies whatever room state the server reported at join.
   *
   * Runs on first join and after every reconnect. On a reconnect the
   * server's participant list wins outright and the old one goes in the
   * bin: anyone who left during the outage must not linger, anyone who
   * joined during it must show up.
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
    this.restoreLocalPublications();
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
        await this.enqueue(() => this.applyRemoteOffer(message.sdp));
        return;
      case ServerMessageType.SDP_ANSWER:
        await this.enqueue(() => this.applyRemoteAnswer(message.sdp));
        return;
      case ServerMessageType.ICE_CANDIDATE:
        await this.enqueue(() => this.applyRemoteCandidate(message));
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
          this.logger.debug("sfu refused our offer as glare; waiting for its offer");
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
    pc.onnegotiationneeded = () => {
      this.logger.debug("browser reports negotiation needed");
      this.negotiationNeeded = true;
      this.scheduleNegotiation();
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
  /**
   * Runs `task` after everything already queued, and before anything
   * queued later.
   *
   * The only way to touch this PeerConnection's signaling state. A failing
   * task must not wedge the chain, so the next one runs either way — the
   * caller still sees the rejection through the promise it holds.
   *
   * Nothing on this chain ever waits for the *peer*: each task does its
   * local half (apply a description, build an answer, send an offer) and
   * returns. Waiting for a reply while holding the chain would deadlock,
   * since the reply itself has to come through here.
   */
  enqueue(task) {
    const run = this.negotiationChain.then(task, task);
    this.negotiationChain = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  /**
   * Nudges the chain to look for work.
   *
   * Does not decide that an offer is needed — `negotiationneeded` does
   * that. Used where a round has just ended, or where a local change has
   * been made and the browser's event may already have fired.
   */
  scheduleNegotiationIfNeeded() {
    if (this.negotiationNeeded || this.publishedTracksMissingFromSdp()) {
      this.scheduleNegotiation();
    }
  }
  scheduleNegotiation() {
    if (this.negotiationScheduled) {
      return;
    }
    this.negotiationScheduled = true;
    void this.enqueue(async () => {
      this.negotiationScheduled = false;
      await this.runNegotiation();
    });
  }
  /**
   * Offers, if there is anything to offer and the connection can take one.
   *
   * Runs on the chain, so `signalingState` cannot change under it between
   * the check and `setLocalDescription`.
   */
  async runNegotiation() {
    const pc = this.pc;
    const signaling = this.signaling;
    if (!pc || !signaling) {
      return;
    }
    if (!this.negotiationNeeded && !this.publishedTracksMissingFromSdp()) {
      return;
    }
    if (pc.signalingState !== "stable") {
      this.logger.debug("negotiation deferred until the current round ends", pc.signalingState);
      return;
    }
    this.negotiationNeeded = false;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      for (const entry of this.published.values()) {
        if (entry.sender) {
          this.msidRefreshAttempted.add(entry.trackId);
        }
      }
      this.reconcilePublicationIds(pc);
      signaling.send({
        type: ClientMessageType.SDP_OFFER,
        sdp: pc.localDescription?.sdp ?? offer.sdp ?? ""
      });
    } catch (error) {
      this.negotiationNeeded = true;
      this.logger.error("could not offer", error.message);
      this.emit("mediaError", new RTCError("MEDIA_ERROR", "Could not negotiate the published track", error));
    }
  }
  /**
   * Answers the SFU.
   *
   * Rolls our own offer back first if one is outstanding. RFC-wise either
   * peer may offer, and something has to break the tie; the SFU is the one
   * with the room-wide view, so it wins and our change is re-queued rather
   * than dropped.
   */
  async applyRemoteOffer(sdp) {
    const pc = this.ensurePeerConnection();
    try {
      if (pc.signalingState === "have-local-offer") {
        this.logger.debug("glare: rolling our offer back and answering the sfu");
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch (error) {
          this.logger.debug("explicit rollback unavailable", error.message);
        }
      }
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.reconcilePublicationIds(pc);
      this.signaling?.send({
        type: ClientMessageType.SDP_ANSWER,
        sdp: pc.localDescription?.sdp ?? answer.sdp ?? ""
      });
    } catch (error) {
      this.logger.error("failed to answer offer", error.message);
      const reason = error instanceof Error ? error.message : String(error);
      this.emit("mediaError", new Error(`Could not answer the server's offer: ${reason}`));
      return;
    }
    this.afterRoundTrip();
  }
  async applyRemoteAnswer(sdp) {
    const pc = this.pc;
    if (!pc) {
      return;
    }
    if (pc.signalingState !== "have-local-offer") {
      this.logger.debug("discarding an answer for a superseded offer", pc.signalingState);
      this.afterRoundTrip();
      return;
    }
    try {
      await pc.setRemoteDescription({ type: "answer", sdp });
    } catch (error) {
      this.logger.error("failed to apply answer", error.message);
    }
    this.afterRoundTrip();
  }
  async applyRemoteCandidate(message) {
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
  /**
   * A round ended: offer again if anything still needs one.
   *
   * Two things can: the browser's own negotiation-needed bit, and Livqeno's
   * requirement that our published tracks appear in the local description
   * by their real ids. See `publishedTracksMissingFromSdp()`.
   */
  afterRoundTrip() {
    if (this.publishedTracksMissingFromSdp()) {
      this.negotiationNeeded = true;
    }
    this.scheduleNegotiationIfNeeded();
  }
  /**
   * Whether some published track's id is absent from the local
   * description's `a=msid:` lines.
   *
   * Livqeno's SFU identifies a published track by the id in the SDP `msid`
   * and matches it against the `track.publish` declaration that says
   * whether it is a camera or a screen share. So it is not enough for the
   * track to be *sending*: our id has to be the one on the wire.
   *
   * It is possible for it not to be. The SFU pre-creates a receive slot
   * for a declared track, and `addTrack` reuses that transceiver; if the
   * SFU's own next offer then covers the m-line, the browser's
   * negotiation-needed bit clears with the SFU's msid still in place. RTP
   * flows — the SFU just has no idea which of our tracks it belongs to,
   * and falls back to guessing from the codec kind. A camera guessed as a
   * camera hides it; a screen share guessed as a camera puts somebody's
   * shared window in the face tile.
   *
   * Checking the SDP rather than trusting a flag is what makes this
   * terminate: one offer of ours puts every id in place, and the answer to
   * the next check is no.
   */
  publishedTracksMissingFromSdp() {
    const pc = this.pc;
    if (!pc || this.published.size === 0) {
      return false;
    }
    const sdp = pc.localDescription?.sdp;
    if (!sdp) {
      return false;
    }
    const announced = /* @__PURE__ */ new Set();
    for (const line of sdp.split(/\r?\n/)) {
      if (!line.startsWith("a=msid:")) {
        continue;
      }
      const trackId = line.slice("a=msid:".length).trim().split(/\s+/)[1];
      if (trackId) {
        announced.add(trackId);
      }
    }
    for (const entry of this.published.values()) {
      if (!entry.sender || announced.has(entry.trackId)) {
        continue;
      }
      if (this.msidRefreshAttempted.has(entry.trackId)) {
        this.logger.warn(
          "published track is not announced by its own id; the sfu will guess its source",
          entry.trackId
        );
        continue;
      }
      this.logger.debug("published track missing from the local sdp", entry.trackId);
      return true;
    }
    return false;
  }
  /**
   * Resolves when the data channel is open.
   *
   * What `sendData()` actually needs to wait for. Waiting on "negotiation
   * has gone quiet" instead resolves a beat too early — the browser raises
   * `negotiationneeded` on a task, so a connection looks quiet for one
   * turn after the channel was created — and the caller would be told its
   * payload had gone out while it was still queued.
   */
  dataChannelOpened() {
    if (this.dataChannel?.readyState === "open") {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.dataChannelWaiters.push({ resolve, reject });
    });
  }
  settleDataChannel() {
    const waiters = this.dataChannelWaiters;
    if (waiters.length === 0) {
      return;
    }
    this.dataChannelWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }
  /**
   * Fails everyone waiting on the data channel, because it is never going
   * to open.
   *
   * Only for a connection that is finished — a terminal failure or a
   * deliberate leave. A reconnect deliberately does *not* come through
   * here: rejoining re-creates the channel and settles the wait, so a
   * `sendData()` made mid-blip still goes out afterwards rather than
   * throwing at the caller.
   */
  abortDataChannelWaiters(reason) {
    const waiters = this.dataChannelWaiters;
    if (waiters.length === 0) {
      return;
    }
    this.dataChannelWaiters = [];
    const error = new RTCError("CONNECTION_FAILED", reason);
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }
  // --- Incoming media ----------------------------------------------------
  /**
   * Matches an arriving track up with whatever signaling said about it.
   *
   * The SFU forwards every subscription carrying the *publisher's* track id
   * as the SDP `msid` track id, and that's what makes attribution possible
   * without a side channel. `ontrack` and `track.published` race, so this
   * only completes a subscription when both halves are in, parking
   * whichever showed up first.
   *
   * # Why the id comes from the SDP, not the track
   *
   * `RTCTrackEvent.track.id` is **not** the remote track id. Chrome mints
   * a brand-new local id for a received track and pays no attention to the
   * `msid`; the id in `a=msid:<stream> <track>` is the remote one. So
   * matching on `event.track.id` never matched anything, ever. And because
   * the unmatched track got parked as "media arrived early", it failed in
   * total silence: a subscription that simply never completed, not an
   * error anybody could see. Reading the `msid` is the standards-defined
   * way to get the id the remote peer actually picked.
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
    this.completeSubscription(announcement.participantId, announcement.track, event.track, event.receiver);
  }
  /**
   * The remote track id for an arriving track, read out of the remote SDP.
   *
   * Found via the transceiver's `mid` rather than by scanning every
   * `a=msid:` line. Someone publishing both a camera and a screen share
   * has two video m-sections, and picking the wrong one labels a screen
   * share as somebody's face.
   *
   * Returns undefined when the SDP doesn't say, either an `msid`-less
   * offer or a transceiver with no mid yet, so the caller can fall back
   * instead of guessing.
   */
  remoteTrackIdFor(event) {
    const mid = event.transceiver?.mid;
    const sdp = this.pc?.remoteDescription?.sdp;
    if (!mid || !sdp) {
      return void 0;
    }
    return msidTrackIdForMid(sdp, mid);
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
  /**
   * Serializes enable/disable per kind.
   *
   * Two `enableCamera()` calls in flight at once used to mean two
   * `getUserMedia` prompts, two senders and one of them orphaned in the
   * `published` map. Callers that overlap now share the first call's
   * result. Per kind rather than global, so a microphone does not queue
   * behind a camera's device prompt.
   */
  async withKindLock(kind, operation) {
    const previous = this.kindOperations.get(kind) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    this.kindOperations.set(
      kind,
      run.then(
        () => void 0,
        () => void 0
      )
    );
    return run;
  }
  async publishKind(kind, capture) {
    return this.withKindLock(kind, () => this.publishKindLocked(kind, capture));
  }
  async publishKindLocked(kind, capture) {
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
    return this.withKindLock(kind, async () => {
      const existing = this.published.get(kind);
      if (!existing) {
        return void 0;
      }
      await this.unpublish(existing.track);
      return void 0;
    });
  }
  async publish(track) {
    const delegate = track["delegate"];
    if (!(delegate instanceof NativeLocalTrackDelegate)) {
      throw new RTCError(
        "MEDIA_ERROR",
        "This track was not created by the Livqeno SDK. Wrap your own MediaStreamTrack with createCustomTrack() (or client.createCustomTrack()) before publishing it"
      );
    }
    this.published.set(track.kind, {
      track,
      delegate,
      trackId: track.mediaStreamTrack.id
    });
    if (!this.localParticipant.tracks.includes(track)) {
      this.localParticipant.tracks.push(track);
    }
    try {
      await this.attachToPeerConnection(track.kind);
    } catch (error) {
      this.published.delete(track.kind);
      const index = this.localParticipant.tracks.indexOf(track);
      if (index !== -1) {
        this.localParticipant.tracks.splice(index, 1);
      }
      throw error;
    }
    this.emit("localTrackPublished", track);
  }
  /**
   * Puts one desired publication onto the current PeerConnection.
   *
   * Everything the SFU needs to know about a track lives here, so the
   * first publish and a post-reconnect restore go through exactly the same
   * code and cannot drift apart. Idempotent: a track already carried by a
   * sender on this connection is left alone, which is what stops a re-sent
   * room state from adding a second sender for the same camera.
   */
  async attachToPeerConnection(kind) {
    const entry = this.published.get(kind);
    if (!entry) {
      return;
    }
    const pc = this.ensurePeerConnection();
    const mediaStreamTrack = entry.track.mediaStreamTrack;
    const alreadyAttached = pc.getSenders().some((sender2) => sender2.track !== null && sender2.track === mediaStreamTrack);
    if (alreadyAttached) {
      return;
    }
    const stream = typeof MediaStream !== "undefined" ? new MediaStream([mediaStreamTrack]) : void 0;
    let sender;
    try {
      sender = stream ? pc.addTrack(mediaStreamTrack, stream) : pc.addTrack(mediaStreamTrack);
    } catch (error) {
      throw new RTCError("MEDIA_ERROR", "Could not add the track to the connection", error);
    }
    const source = declaredSourceFor(kind);
    if (source) {
      this.signaling?.send({
        type: ClientMessageType.TRACK_PUBLISH,
        trackId: mediaStreamTrack.id,
        source
      });
    }
    entry.sender = sender;
    entry.trackId = mediaStreamTrack.id;
    entry.delegate.setSender(sender);
    await this.applySimulcast(sender, kind);
    mediaStreamTrack.onended = () => {
      void this.unpublish(entry.track).catch(() => void 0);
    };
    this.scheduleNegotiationIfNeeded();
  }
  /**
   * Makes the publication ids we told the SFU match the ids on the wire.
   *
   * A publication's identity in this protocol is the track id in the SDP
   * `a=msid:` line. The SFU keys everything on it — the published-track
   * map, the `track.publish` source declaration, mute lookups, and the id
   * it announces to subscribers — and it reads that id off the RTP stream
   * as `TrackRemote.ID()`. Nothing else in the exchange identifies a
   * publication, which is why the id has to be right rather than merely
   * plausible.
   *
   * It was not always right. The SFU pre-creates one recvonly audio and
   * one recvonly video transceiver for every subscribing participant, so
   * that a first publish costs no extra renegotiation. `addTrack` reuses
   * those, and the m-section can keep the msid it already had —
   * Chrome will not rewrite an id it did not author. So the SFU received a
   * stream announcing one id while the declaration named another, found no
   * match, and fell back to inferring the source from the codec kind:
   * right for a camera, right for a microphone, and wrong for a screen
   * share, which then arrives labelled `camera` and lands in the face tile
   * of every layout keyed on source.
   *
   * The fix is to read what the browser actually wrote and declare that.
   * Called immediately after our own `setLocalDescription` and before the
   * description goes out, so the corrected declaration reaches the SFU
   * ahead of the media it describes — same socket, so ordering holds
   * without waiting for anything.
   *
   * No SDP is rewritten and no identifier is invented: this is the
   * protocol's existing publication id, finally taken from the one place
   * that knows it.
   */
  reconcilePublicationIds(pc) {
    const sdp = pc.localDescription?.sdp;
    if (!sdp || this.published.size === 0) {
      return;
    }
    for (const [kind, entry] of this.published) {
      if (!entry.sender) {
        continue;
      }
      const mid = pc.getTransceivers().find((t) => t.sender === entry.sender)?.mid;
      if (!mid) {
        continue;
      }
      const onTheWire = msidTrackIdForMid(sdp, mid);
      if (!onTheWire || onTheWire === entry.trackId) {
        continue;
      }
      this.logger.debug(
        "publication id corrected from the sdp",
        `${kind}: ${entry.trackId} -> ${onTheWire} (mid ${mid})`
      );
      entry.trackId = onTheWire;
      const source = declaredSourceFor(kind);
      if (source) {
        this.signaling?.send({
          type: ClientMessageType.TRACK_PUBLISH,
          trackId: onTheWire,
          source
        });
      }
    }
  }
  /**
   * Re-publishes everything this participant wants published onto a
   * replacement PeerConnection.
   *
   * Runs on every join, so a reconnect restores the microphone, camera and
   * screen share that were live before the outage — in one renegotiation,
   * because every `addTrack` here lands before the browser's queued
   * `negotiationneeded` task runs.
   *
   * A screen share is the one case where desired state can have expired
   * while we were away: ending the share is the user's own doing, through
   * browser UI Livqeno never sees, and its track is dead for good. Restoring
   * a dead track would publish an m-section that never carries a frame, so
   * it is dropped and the room is told, exactly as if the user had stopped
   * sharing while connected.
   */
  restoreLocalPublications() {
    if (this.dataChannelWanted && !this.dataChannel) {
      this.openDataChannel();
    }
    this.msidRefreshAttempted.clear();
    for (const [kind, entry] of [...this.published]) {
      if (entry.track.mediaStreamTrack.readyState === "ended") {
        this.logger.debug("dropping a publication whose source has ended", kind);
        this.published.delete(kind);
        const index = this.localParticipant.tracks.indexOf(entry.track);
        if (index !== -1) {
          this.localParticipant.tracks.splice(index, 1);
        }
        entry.sender = void 0;
        entry.delegate.setSender(void 0);
        this.emit("localTrackUnpublished", entry.track);
        continue;
      }
      entry.sender = void 0;
      entry.delegate.setSender(void 0);
      void this.attachToPeerConnection(kind).catch((error) => {
        this.logger.error("could not restore a publication", kind, error.message);
        this.emit("mediaError", error instanceof Error ? error : new Error(String(error)));
      });
    }
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
    if (entry.sender) {
      try {
        this.pc?.removeTrack(entry.sender);
      } catch (error) {
        this.logger.debug("removeTrack failed", error.message);
      }
      entry.sender = void 0;
    }
    this.msidRefreshAttempted.delete(entry.trackId);
    track.mediaStreamTrack.onended = null;
    track.mediaStreamTrack.stop();
    this.emit("localTrackUnpublished", track);
  }
  /**
   * Sets up simulcast on a video sender (spec §15).
   *
   * Three spatial layers, each a quarter of the previous one's pixel count.
   * That's the standard ladder and the one browsers actually implement
   * well. Applied with `setParameters` after `addTrack` instead of through
   * `addTransceiver`'s `sendEncodings`, because the transceiver may already
   * exist from the SFU's offer and re-adding it would renegotiate for
   * nothing at all.
   *
   * Audio gets left alone. There's no spatial layering to do, and Opus
   * already sorts its own bitrate out.
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
    channel.onopen = () => {
      this.logger.debug("data channel open");
      this.settleDataChannel();
      this.flushDataQueue();
    };
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
    if (channel.readyState === "open") {
      this.settleDataChannel();
      this.flushDataQueue();
    }
  }
  /**
   * Sends a payload, waiting for the channel if it is still coming up.
   *
   * A data channel needs its own `m=application` section, which means a
   * round trip before the first byte can go anywhere. That used to be the
   * caller's problem: `sendData()` created the channel, negotiated
   * nothing, and threw "The data channel is not open yet" — so the only
   * way to make data work was to publish a camera first and let its
   * renegotiation carry the channel along. Now the bootstrap happens here.
   */
  async sendData(payload) {
    if (payload.byteLength > MAX_DATA_PAYLOAD_BYTES) {
      throw new RTCError(
        "MEDIA_ERROR",
        `Data payload is ${payload.byteLength} bytes, over the ${MAX_DATA_PAYLOAD_BYTES}-byte limit`
      );
    }
    if (!this.pc && !this.signaling) {
      throw new RTCError("CONNECTION_FAILED", "sendData() requires an active connection");
    }
    const channel = this.dataChannel ?? this.openDataChannel();
    if (!channel) {
      throw new RTCError("CONNECTION_FAILED", "sendData() requires an active connection");
    }
    if (channel.readyState === "open") {
      this.sendOnChannel(channel, payload);
      return;
    }
    this.dataQueue.push(payload);
    await this.dataChannelOpened();
    this.flushDataQueue();
  }
  /**
   * Opens the data channel for a participant that only wants to receive.
   *
   * The SFU fans data out over each recipient's own channel, so somebody
   * who never sends has nothing to receive on. `Room` calls this the
   * moment an application listens for `dataReceived`, which is the only
   * honest signal that a channel is wanted — opening one for every
   * participant at join would cost an SCTP association on every call that
   * never sends a byte.
   */
  ensureDataChannel() {
    this.dataChannelWanted = true;
    if (!this.dataChannel) {
      this.openDataChannel();
    }
  }
  /**
   * Creates the channel and asks for the renegotiation that carries it.
   *
   * Exactly once per connection: `dataChannel` is set synchronously here,
   * so two concurrent `sendData()` calls cannot both create one. A second
   * channel would be a second SCTP stream the SFU closes as unrecognised.
   *
   * The client creates it, not the server, because the client is the side
   * that knows it needs one. Ordered and reliable — the default, and what
   * anyone sending structured messages expects.
   */
  openDataChannel() {
    this.dataChannelWanted = true;
    const pc = this.pc ?? (this.signaling ? this.ensurePeerConnection() : void 0);
    if (!pc) {
      return void 0;
    }
    if (this.dataChannel) {
      return this.dataChannel;
    }
    const channel = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.attachDataChannel(channel);
    return channel;
  }
  flushDataQueue() {
    const channel = this.dataChannel;
    if (!channel || channel.readyState !== "open" || this.dataQueue.length === 0) {
      return;
    }
    const queued = this.dataQueue;
    this.dataQueue = [];
    for (const payload of queued) {
      this.sendOnChannel(channel, payload);
    }
  }
  sendOnChannel(channel, payload) {
    try {
      channel.send(payload);
    } catch (error) {
      throw new RTCError("PERMISSION_DENIED", "Could not send data; check the token grants publishData", error);
    }
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
   * Swaps the device behind a published track without renegotiating.
   *
   * `replaceTrack` is what makes it seamless. Transceiver, SSRC, and every
   * subscriber's view of the track all stay put, so nobody else in the
   * room notices a thing.
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
   * `setSinkId` works per element, so this walks whatever elements each
   * remote audio track is attached to. Safari doesn't have `setSinkId` at
   * all. `Room.setSpeakerDevice()` checks and throws before we get here,
   * so an unsupported browser gets a real error instead of a silent no-op.
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
      entry.track.mediaStreamTrack.onended = null;
      entry.track.mediaStreamTrack.stop();
    }
    this.published.clear();
    this.localParticipant.tracks.length = 0;
    this.dataChannelWanted = false;
    this.dataQueue = [];
    this.negotiationNeeded = false;
    this.abortDataChannelWaiters("The room was left before the data channel could open");
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
function msidTrackIdForMid(sdp, mid) {
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
  /** @internal Use `client.join(roomId)`. The telemetry client defaults to a no-op, so tests and advanced setups can build a Room directly without wiring one up. */
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
   * A non-secret diagnostic snapshot for support and debugging.
   *
   * Synchronous and cheap by design, so you can call it from anywhere at
   * any time, error handlers included. Live media stats are a separate
   * `async` call; see `getConnectionStats()`.
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
   * Live media-quality stats for every published and subscribed track.
   * RTT, jitter, packet loss, bitrate, codec, resolution/fps, and the
   * SFU's own connection-quality read. `ConnectionStats` explains why this
   * is kept apart from `getDiagnostics()`.
   *
   * Call it whenever you like, including before anything is published or
   * subscribed. You just get empty `local`/`remote` arrays then, not an
   * error.
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
   * Polls `getConnectionStats()` on a timer and ships the result as
   * telemetry, so the dashboard's RTC view (spec §23) has numbers to show
   * without every developer wiring it up by hand. Best-effort, same as
   * every other telemetry event here: failures get swallowed. A hiccup
   * collecting stats is no reason to disturb the call it's describing.
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
  /** Captures and publishes the camera in one go. Resolves to the published track. */
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
  /**
   * Two events get special treatment here.
   *
   * **`dataReceived`** is what provisions this participant's data channel.
   * The SFU fans data out over each recipient's own channel, and a channel
   * is only created on demand — most calls never send a byte, and an SCTP
   * association for every participant regardless is a cost with nothing
   * behind it. So a page that never called `sendData()` could not
   * *receive* either, which made data one-way in exactly the setup people
   * try first. Subscribing to the event is the signal that one is wanted.
   *
   * **`trackSubscribed`** is replayed for tracks that were already
   * subscribed when the handler was added.
   *
   * Without that, joining a room where somebody is *already* publishing
   * never tells you about them. `client.join()` subscribes to the existing
   * publishers and emits during `connect()`, which is before the promise
   * resolves — so by the time a caller has a `Room` to call `.on()` on,
   * the events are gone. Media arrives and decodes; the application simply
   * never hears about it and renders nothing. That is the normal case for
   * a live stream, where every viewer joins a broadcast already in
   * progress, and the shape the documented example uses:
   *
   * ```ts
   * const room = await client.join(name);           // subscribes here
   * room.on('trackSubscribed', (t) => …);           // …handler added here
   * ```
   *
   * Only tracks a handler demonstrably missed are replayed — the ones
   * subscribed before it was added — so a handler registered up front
   * still sees each track exactly once, and adding a second handler later
   * cannot double-deliver to the first. Delivery is deferred to a
   * microtask so `.on()` stays a plain registration call and never
   * re-enters the caller before it has returned. `Promise.resolve()`
   * rather than `queueMicrotask`, so this holds on every engine the SDK
   * ships to, React Native's included.
   */
  on(event, handler) {
    if (event === "dataReceived") {
      this.adapter.ensureDataChannel?.();
    }
    if (event === "trackSubscribed") {
      const missed = this.remoteParticipants.flatMap(
        (participant) => participant.tracks.map((track) => ({ track, participant }))
      );
      if (missed.length > 0) {
        const subscribed = handler;
        void Promise.resolve().then(() => {
          for (const { track, participant } of missed) {
            subscribed(track, participant);
          }
        });
      }
    }
    return super.on(event, handler);
  }
  /**
   * Publishes a track you made with `client.createCameraTrack()` and
   * friends, or one you wrapped with `client.createCustomTrack()`.
   */
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
   * audio elements. Phase 11 addition. Not supported everywhere: Safari
   * has no `HTMLMediaElement.setSinkId`. Browsers that don't implement it
   * get a `DEVICE_NOT_FOUND` throw instead of a silent no-op.
   */
  async setSpeakerDevice(deviceId) {
    if (typeof document !== "undefined") {
      const probe = document.createElement("audio");
      if (typeof probe.setSinkId !== "function") {
        throw new RTCError(
          "DEVICE_NOT_FOUND",
          "This browser doesn't support selecting an audio output device (no setSinkId)"
        );
      }
    }
    await this.adapter.setDevice("audiooutput", deviceId);
  }
  /**
   * Sends a small payload to everyone, or to specific people if the
   * underlying SFU adapter supports targeting. Requires the token's
   * `publishData` grant; throws PERMISSION_DENIED without it.
   *
   * Works in an empty room with nothing published. The first call has to
   * negotiate a data channel — one round trip — which this awaits on your
   * behalf; payloads sent while the channel is still opening are queued
   * and go out in order. Rejects with CONNECTION_FAILED if the connection
   * dies before the channel can open, rather than hanging.
   */
  async sendData(payload) {
    const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : new Uint8Array(payload);
    await this.adapter.sendData(bytes);
  }
  /**
   * Resolves once the media connection is genuinely up.
   *
   * # Why this exists
   *
   * `client.join()` resolves when the **control plane** lets you in: room
   * joined, you know who else is here, you can publish. The media
   * connection finishes a moment later, once ICE and DTLS are done, which
   * means `connectionState` sits at `'connecting'` for a short window
   * after `join()` returns. That's the honest shape of an SFU connection,
   * and it's why `'connected'` is an event, not something joining
   * guarantees you.
   *
   * Most callers need none of this. `enableCamera()` and
   * `enableMicrophone()` work fine inside that window, and the `connected`
   * event is what you want driving a UI. This is for code that genuinely
   * has to block: a test, or a flow that mustn't move on until media is
   * live.
   *
   * Resolves straight away if already connected. Rejects on `'failed'` and
   * on timeout, rather than handing back a connection that isn't there.
   *
   * Careful: a subscriber joining a room where nobody is publishing can
   * quite legitimately stay `'connecting'`. With no tracks on either side
   * there's nothing to negotiate, so waiting here times out on a
   * connection that isn't broken at all. Where you can, drive the UI off
   * the `connected` event instead of blocking on this.
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
              `Still ${this.connectionState} after ${timeoutMs}ms; the media connection did not establish`
            )
          )
        );
      }, timeoutMs);
      this.on("connectionStateChanged", onState);
    });
  }
  /** Leaves the room, stops local tracks and closes the underlying connection. */
  async leave() {
    this.stopStatsMonitor();
    await this.adapter.disconnect();
  }
};
/**
 * How often the stats monitor samples and reports. Often enough that a
 * dashboard showing "now" isn't showing you five minutes ago, rarely
 * enough that it doesn't hammer the telemetry endpoint on a call where
 * dozens of participants are all doing exactly this.
 */
_Room.STATS_INTERVAL_MS = 5e3;
var Room = _Room;

// src/client.ts
var defaultAdapterFactory = (logger, autoReconnect) => new RavenAdapter(logger, autoReconnect);
var RTCClient = class {
  /**
   * @internal Use `createRTCClient(config)`. The second param exists purely
   * so tests can inject a fake SFUAdapter without a real browser and WebRTC
   * stack. Not part of the public config.
   */
  constructor(config, adapterFactory = defaultAdapterFactory) {
    this.config = config;
    this.logger = createLogger(config.logLevel);
    this.adapterFactory = adapterFactory;
  }
  /**
   * Joins the room this client's token was minted for.
   *
   * `roomId` is optional, because the token already names its room in the
   * `rnm`/`rid` claims — so `createRTCClient(grant)` then `join()` needs
   * nothing the mint response didn't already supply. Pass one explicitly
   * and it still has to match: a mismatch is `ROOM_NOT_FOUND` straight
   * away, before any connection is attempted.
   *
   * A token carrying neither claim (older tokens, hand-built test doubles)
   * has nothing to default to, and says so rather than connecting to a
   * room nobody named.
   */
  async join(roomId) {
    const target = roomId ?? roomFromToken(this.config.token);
    assertTokenMatchesRoom(this.config.token, target);
    this.logger.info("joining room", target);
    const telemetry = createTelemetryClient({
      enabled: this.config.telemetry,
      telemetryUrl: this.config.telemetryUrl,
      token: this.config.token,
      sdkVersion: SDK_VERSION,
      logger: this.logger
    });
    telemetry.send("connection_started");
    const adapter = this.adapterFactory(this.logger, this.config.autoReconnect);
    const room = new Room(adapter, target, this.logger, telemetry);
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
  /** Leaves the most recently joined room, if there is one. Same as `.leave()` on that `Room`. */
  async leave() {
    await this.currentRoom?.leave();
    this.currentRoom = void 0;
  }
  /** Captures a camera track without joining or publishing. Pair it with `room.publish(track)`. */
  async createCameraTrack(deviceId) {
    return createCameraTrack(deviceId ? { deviceId } : {});
  }
  /** Captures a microphone track without joining or publishing. Pair it with `room.publish(track)`. */
  async createMicrophoneTrack(deviceId) {
    return createMicrophoneTrack(deviceId ? { deviceId } : {});
  }
  /** Captures a screen-share track without joining or publishing. Pair it with `room.publish(track)`. */
  async createScreenShareTrack() {
    return createScreenShareTrack();
  }
  /**
   * Wraps a `MediaStreamTrack` your application produced — a
   * `canvas.captureStream()` frame source, a Web Audio graph, a decoded
   * file, a virtual camera — so it can be published like any other track.
   *
   * Synchronous, because there is nothing to capture: you already have the
   * track. `source` decides how the SFU labels it for everyone else, and
   * defaults to `camera` for video and `microphone` for audio.
   *
   * ```ts
   * const canvasTrack = canvas.captureStream(30).getVideoTracks()[0];
   * await room.publish(client.createCustomTrack(canvasTrack, { source: 'camera' }));
   * ```
   *
   * Livqeno never captured this track, so stopping the underlying source is
   * yours to do; `room.unpublish(track)` stops the track itself, as it
   * does for every other kind.
   */
  createCustomTrack(mediaStreamTrack, options = {}) {
    return createCustomTrack(mediaStreamTrack, options);
  }
  /** Lists available devices. Labels only fill in once permission has been granted at least once. */
  async getDevices(kind) {
    return listDevices(kind);
  }
  /**
   * Subscribes to devices coming and going (Phase 11 addition), like a USB
   * webcam being plugged in or yanked out. Returns an unsubscribe function.
   *
   * In an environment with no `navigator.mediaDevices` this is a no-op with
   * an immediately-callable unsubscribe, rather than a throw. It's an
   * optional convenience, not a capability anything depends on.
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
      throw new RTCError("CONNECTION_FAILED", "setCamera() requires an active room; call join() first");
    }
    await this.currentRoom.setCameraDevice(deviceId);
  }
  /** Switches the active microphone on the currently joined room. */
  async setMicrophone(deviceId) {
    if (!this.currentRoom) {
      throw new RTCError("CONNECTION_FAILED", "setMicrophone() requires an active room; call join() first");
    }
    await this.currentRoom.setMicrophoneDevice(deviceId);
  }
  /** Diagnostic snapshot of the currently joined room. See `Room.getDiagnostics()`. */
  getDiagnostics() {
    if (!this.currentRoom) {
      throw new RTCError("CONNECTION_FAILED", "getDiagnostics() requires an active room; call join() first");
    }
    return this.currentRoom.getDiagnostics();
  }
};
function roomFromToken(token) {
  const { roomName, roomId } = decodeTokenPayload(token);
  const room = roomName ?? roomId;
  if (!room) {
    throw new RTCError(
      "ROOM_NOT_FOUND",
      'join() with no argument needs the room from the token, but this token carries neither an "rnm" nor an "rid" claim. Pass the room explicitly: join(roomName).'
    );
  }
  return room;
}
function createRTCClient(config) {
  const resolved = validateConfig(config);
  return new RTCClient(resolved);
}

// src/browser-support.ts
function getBrowserSupportDetails() {
  const missing = [];
  if (typeof RTCPeerConnection === "undefined") missing.push("RTCPeerConnection");
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
    missing.push("navigator.mediaDevices.getUserMedia");
  if (typeof WebSocket === "undefined") missing.push("WebSocket");
  return { supported: missing.length === 0, missing };
}
function isBrowserSupported() {
  return getBrowserSupportDetails().supported;
}

export { LocalParticipant, LocalTrack, Participant, RTCClient, RTCError, RemoteParticipant, RemoteTrack, Room, Track, createCustomTrack, createRTCClient, getBrowserSupportDetails, isBrowserSupported, isRTCError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map