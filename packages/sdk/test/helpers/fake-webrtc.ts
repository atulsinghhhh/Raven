/**
 * A minimal WebRTC and WebSocket environment for jsdom.
 *
 * jsdom implements neither, and the adapter's job is almost entirely
 * *protocol* logic — which offer to answer, which track belongs to whom,
 * what to send when a publisher mutes. That logic is worth testing without
 * a browser, so this provides just enough of the two APIs for it to run,
 * and exposes the seams a test needs to drive it.
 *
 * What this deliberately does not do is simulate media. Nothing here
 * encodes, forwards, or transports a byte. Whether media actually flows is
 * settled by the SFU's own tests, which run real Pion PeerConnections
 * against a real forwarding path — see `services/sfu/internal/room/media_test.go`.
 * Faking media here would produce a test that passes while the product is
 * broken, which is worse than no test.
 */

export class FakeMediaStreamTrack implements Partial<MediaStreamTrack> {
  enabled = true;
  readonly muted = false;
  readyState: MediaStreamTrackState = 'live';
  onended: (() => void) | null = null;
  stopped = false;

  constructor(
    readonly kind: 'audio' | 'video',
    readonly id: string,
  ) {}

  stop(): void {
    this.stopped = true;
    this.readyState = 'ended';
  }

  /** Simulates the user ending a screen share from the browser's own bar. */
  end(): void {
    this.stop();
    this.onended?.();
  }
}

export class FakeMediaStream {
  readonly id: string;
  private readonly tracks: FakeMediaStreamTrack[];

  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
    this.id = `stream-${Math.random().toString(36).slice(2, 8)}`;
  }

  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

export class FakeRTCRtpSender {
  track: FakeMediaStreamTrack | null;
  private parameters: RTCRtpSendParameters;
  readonly setParametersCalls: RTCRtpSendParameters[] = [];

  constructor(track: FakeMediaStreamTrack | null, encodings: RTCRtpEncodingParameters[]) {
    this.track = track;
    this.parameters = { encodings, transactionId: 'tx', codecs: [], headerExtensions: [], rtcp: {} } as unknown as RTCRtpSendParameters;
  }

  getParameters(): RTCRtpSendParameters {
    return this.parameters;
  }

  async setParameters(parameters: RTCRtpSendParameters): Promise<void> {
    this.setParametersCalls.push(parameters);
    this.parameters = parameters;
  }

  async replaceTrack(track: FakeMediaStreamTrack | null): Promise<void> {
    this.track = track;
  }

  async getStats(): Promise<RTCStatsReport> {
    return new Map() as unknown as RTCStatsReport;
  }
}

export class FakeRTCRtpReceiver {
  constructor(readonly track: FakeMediaStreamTrack) {}

  async getStats(): Promise<RTCStatsReport> {
    return new Map() as unknown as RTCStatsReport;
  }
}

export class FakeRTCDataChannel {
  readyState: RTCDataChannelState = 'open';
  binaryType = 'arraybuffer';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: unknown[] = [];
  closed = false;

  constructor(readonly label: string) {}

  send(payload: unknown): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closed = true;
    this.readyState = 'closed';
    this.onclose?.();
  }

  /** Simulates a message arriving from another participant, via the SFU. */
  receive(payload: ArrayBuffer | string): void {
    this.onmessage?.({ data: payload } as MessageEvent);
  }
}

/**
 * A PeerConnection that records what was asked of it and lets a test drive
 * its callbacks.
 *
 * `signalingState` is tracked honestly, because the adapter's glare
 * avoidance depends on it: a fake that always reported `'stable'` would
 * make the deferred-publish path untestable.
 */
export class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  closed = false;

  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;

  readonly senders: FakeRTCRtpSender[] = [];
  readonly addedTracks: FakeMediaStreamTrack[] = [];
  readonly removedSenders: FakeRTCRtpSender[] = [];
  readonly appliedCandidates: RTCIceCandidateInit[] = [];
  readonly dataChannels: FakeRTCDataChannel[] = [];
  /** Encodings handed to the next sender created by addTrack. */
  nextSenderEncodings: RTCRtpEncodingParameters[] = [{}];

  constructor(readonly configuration?: RTCConfiguration) {
    FakeRTCPeerConnection.instances.push(this);
  }

  static reset(): void {
    FakeRTCPeerConnection.instances = [];
  }

  static get latest(): FakeRTCPeerConnection {
    const instance = FakeRTCPeerConnection.instances.at(-1);
    if (!instance) {
      throw new Error('no FakeRTCPeerConnection has been created');
    }
    return instance;
  }

  addTrack(track: FakeMediaStreamTrack): FakeRTCRtpSender {
    this.addedTracks.push(track);
    const sender = new FakeRTCRtpSender(track, this.nextSenderEncodings);
    this.senders.push(sender);
    return sender;
  }

  removeTrack(sender: FakeRTCRtpSender): void {
    this.removedSenders.push(sender);
  }

  createDataChannel(label: string): FakeRTCDataChannel {
    const channel = new FakeRTCDataChannel(label);
    this.dataChannels.push(channel);
    return channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0 fake-client-offer' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0 fake-client-answer' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description as RTCSessionDescription;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.appliedCandidates.push(candidate);
  }

  async getStats(): Promise<RTCStatsReport> {
    return new Map() as unknown as RTCStatsReport;
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }

  // --- Test drivers ------------------------------------------------------

  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  emitIceCandidate(candidate: Partial<RTCIceCandidate>): void {
    this.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent);
  }

  /**
   * Fires `ontrack`, optionally with the transceiver `mid` a real browser
   * would attach.
   *
   * `mid` matters because the remote track id lives in the SDP's `a=msid:`
   * line, not on the track: Chrome mints its own id for a received track.
   * A test that wants to exercise that has to supply the mid so the
   * adapter can find the right m-section. Omitting it reproduces a stack
   * that reports no mid, where the adapter falls back to `track.id`.
   */
  emitTrack(track: FakeMediaStreamTrack, mid?: string): FakeRTCRtpReceiver {
    const receiver = new FakeRTCRtpReceiver(track);
    this.ontrack?.({
      track,
      receiver,
      streams: [new FakeMediaStream([track])],
      transceiver: mid === undefined ? undefined : ({ mid } as RTCRtpTransceiver),
    } as unknown as RTCTrackEvent);
    return receiver;
  }

  emitDataChannel(label: string): FakeRTCDataChannel {
    const channel = new FakeRTCDataChannel(label);
    this.ondatachannel?.({ channel } as unknown as RTCDataChannelEvent);
    return channel;
  }
}

/** A WebSocket a test can inspect and feed messages into. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = 0;

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly sent: string[] = [];
  closeCode?: number;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    // Opened on a microtask so a caller can attach handlers first, which
    // is what a real WebSocket does too.
    void Promise.resolve().then(() => this.open());
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  static get latest(): FakeWebSocket {
    const instance = FakeWebSocket.instances.at(-1);
    if (!instance) {
      throw new Error('no FakeWebSocket has been created');
    }
    return instance;
  }

  open(): void {
    this.readyState = this.OPEN;
    this.onopen?.();
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code?: number): void {
    this.closeCode = code;
    this.readyState = this.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason: '' } as CloseEvent);
  }

  /** Delivers a server message. */
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  /** Every message the client sent, parsed. */
  sentMessages(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  lastSent(type: string): Record<string, unknown> | undefined {
    return this.sentMessages().reverse().find((message) => message.type === type);
  }
}

/**
 * Installs the fakes on `globalThis` and returns a teardown.
 *
 * Installed per test rather than once in setup, so a test that needs
 * different behaviour can swap one out, and so a leaked handler cannot
 * affect the next test.
 */
export function installFakeWebRTC(): () => void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    RTCPeerConnection: globals.RTCPeerConnection,
    WebSocket: globals.WebSocket,
    MediaStream: globals.MediaStream,
    navigator: globals.navigator,
  };

  FakeRTCPeerConnection.reset();
  FakeWebSocket.reset();

  globals.RTCPeerConnection = FakeRTCPeerConnection;
  globals.WebSocket = FakeWebSocket;
  globals.MediaStream = FakeMediaStream;

  return () => {
    globals.RTCPeerConnection = saved.RTCPeerConnection;
    globals.WebSocket = saved.WebSocket;
    globals.MediaStream = saved.MediaStream;
    globals.navigator = saved.navigator;
  };
}

/** Stubs `navigator.mediaDevices` so capture resolves to fake tracks. */
export function installFakeMediaDevices(options: { devices?: MediaDeviceInfo[] } = {}): void {
  const mediaDevices = {
    getUserMedia: async (constraints: MediaStreamConstraints) => {
      const kind: 'audio' | 'video' = constraints.audio ? 'audio' : 'video';
      return new FakeMediaStream([new FakeMediaStreamTrack(kind, `local-${kind}`)]);
    },
    getDisplayMedia: async () =>
      new FakeMediaStream([new FakeMediaStreamTrack('video', 'local-screen')]),
    enumerateDevices: async () => options.devices ?? [],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { ...(globalThis.navigator ?? {}), mediaDevices },
  });
}

/** Builds an unsigned Raven RTC token whose claims the SDK can read. */
export function fakeToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature-not-checked-by-the-client`;
}

/** Lets queued microtasks and zero-delay timers run. */
export async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}
