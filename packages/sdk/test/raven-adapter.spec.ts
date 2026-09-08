import { RavenAdapter } from '../src/internal/sfu/raven-adapter';
import { createLogger } from '../src/logger';
import { RTCError } from '../src/errors';
import type { RemoteParticipant } from '../src/participant';
import type { RemoteTrack, TrackKind } from '../src/track';
import {
  FakeMediaStreamTrack,
  FakeRTCPeerConnection,
  FakeWebSocket,
  fakeToken,
  flush,
  installFakeMediaDevices,
  installFakeWebRTC,
} from './helpers/fake-webrtc';

const ENDPOINT = 'ws://localhost:4000/v1/rtc';

const TOKEN = fakeToken({
  jti: 'rtc-token-1',
  sub: 'alice',
  pid: 'project-1',
  env: 'DEVELOPMENT',
  rid: 'room-1',
  rnm: 'demo-room',
  perms: {
    join: true,
    subscribe: true,
    publish: true,
    publishAudio: true,
    publishVideo: true,
    publishData: true,
  },
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 600,
  aud: 'raven-rtc',
  iss: 'raven',
});

/** Connects an adapter and completes the join handshake. */
async function connectAdapter(
  options: { autoReconnect?: boolean; participants?: { id: string; tracks?: unknown[] }[] } = {},
): Promise<{ adapter: RavenAdapter; socket: FakeWebSocket }> {
  const adapter = new RavenAdapter(createLogger('silent'), options.autoReconnect ?? true);
  const connecting = adapter.connect(ENDPOINT, TOKEN, [{ urls: 'stun:localhost:3478' }]);

  await flush();
  const socket = FakeWebSocket.latest;
  socket.receive({
    type: 'room.joined',
    roomId: 'room-1',
    participants: options.participants ?? [],
    rtcServer: 'sfu-local-01',
    region: 'local',
  });

  await connecting;
  return { adapter, socket };
}

/** Answers an SFU offer, which is what brings the PeerConnection into being. */
async function receiveOffer(socket: FakeWebSocket, sdp = 'v=0 fake-server-offer'): Promise<FakeRTCPeerConnection> {
  socket.receive({ type: 'sdp.offer', sdp });
  await flush();
  return FakeRTCPeerConnection.latest;
}

/**
 * An offer shaped the way the SFU's are: one m-section per subscription,
 * publisher's track id sitting in `a=msid:`. That's where the remote track
 * id actually lives.
 */
function offerWithMsid(sections: Array<{ mid: string; streamId: string; trackId: string }>): string {
  return [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    ...sections.flatMap(({ mid, streamId, trackId }) => [
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      `a=mid:${mid}`,
      `a=msid:${streamId} ${trackId}`,
      'a=sendonly',
    ]),
  ].join('\r\n');
}

describe('RavenAdapter', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = installFakeWebRTC();
    installFakeMediaDevices();
  });

  afterEach(() => {
    teardown();
  });

  describe('connecting', () => {
    it('opens the signaling socket with the token and joins the room', async () => {
      const { socket } = await connectAdapter();

      expect(socket.url).toContain(encodeURIComponent(TOKEN));
      expect(socket.lastSent('room.join')).toMatchObject({ roomId: 'room-1' });
    });

    it('takes its identity from the token, not from the server', async () => {
      const { adapter } = await connectAdapter();
      expect(adapter.localParticipant.identity).toBe('alice');
    });

    it('reports the participants already in the room', async () => {
      const { adapter } = await connectAdapter({
        participants: [{ id: 'bob' }, { id: 'carol' }],
      });

      expect([...adapter.remoteParticipants.keys()].sort()).toEqual(['bob', 'carol']);
    });

    it('fails with a typed error when the server rejects the token', async () => {
      const adapter = new RavenAdapter(createLogger('silent'), false);
      const connecting = adapter.connect(ENDPOINT, TOKEN);

      await flush();
      FakeWebSocket.latest.receive({
        type: 'error',
        code: 'TOKEN_EXPIRED',
        message: 'RTC token has expired',
      });

      await expect(connecting).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
      expect(adapter.connectionState).toBe('failed');
    });

    it('rejects a token that names no room before opening a socket', async () => {
      const adapter = new RavenAdapter(createLogger('silent'), false);

      await expect(adapter.connect(ENDPOINT, fakeToken({ sub: 'alice' }))).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('passes the mint response\'s ICE servers to the PeerConnection', async () => {
      // A developer forwards `iceServers` from the token response. They
      // have to reach the connection, or NAT traversal drops back to host
      // candidates and nothing else.
      const { socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      expect(pc.configuration?.iceServers).toEqual([{ urls: 'stun:localhost:3478' }]);
    });
  });

  describe('negotiation', () => {
    it('answers the SFU\'s offer', async () => {
      const { socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      expect(pc.remoteDescription?.sdp).toBe('v=0 fake-server-offer');
      expect(socket.lastSent('sdp.answer')).toMatchObject({ sdp: 'v=0 fake-client-answer' });
    });

    it('forwards local ICE candidates to the server', async () => {
      const { socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      pc.emitIceCandidate({
        candidate: 'candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'abc',
      });

      expect(socket.lastSent('ice.candidate')).toEqual({
        type: 'ice.candidate',
        candidate: 'candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'abc',
      });
    });

    it('does not forward the end-of-candidates signal', async () => {
      const { socket } = await connectAdapter();
      const pc = await receiveOffer(socket);
      const before = socket.sentMessages().length;

      pc.onicecandidate?.({ candidate: null } as RTCPeerConnectionIceEvent);

      expect(socket.sentMessages()).toHaveLength(before);
    });

    it('applies remote ICE candidates', async () => {
      const { socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      socket.receive({
        type: 'ice.candidate',
        candidate: 'candidate:2 1 udp 1 192.0.2.1 3478 typ srflx',
        sdpMid: '0',
      });
      await flush();

      expect(pc.appliedCandidates).toHaveLength(1);
      expect(pc.appliedCandidates[0].candidate).toContain('srflx');
    });

    it('reports connected once the PeerConnection is', async () => {
      // Not when the WebSocket opens. Signaling being up tells you nothing
      // about whether media can flow.
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);
      expect(adapter.connectionState).not.toBe('connected');

      pc.setConnectionState('connected');
      expect(adapter.connectionState).toBe('connected');
    });

    it('ignores a transient ICE disconnect rather than flapping the state', async () => {
      // WebRTC's `disconnected` is recoverable by definition. A UI that
      // flashes "reconnecting" at every little blip is worse than one that
      // holds its nerve.
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);
      pc.setConnectionState('connected');

      pc.setConnectionState('disconnected');

      expect(adapter.connectionState).toBe('connected');
    });
  });

  describe('remote participants and tracks', () => {
    it('emits participantJoined and participantLeft', async () => {
      const { adapter, socket } = await connectAdapter();
      const joined: string[] = [];
      const left: string[] = [];
      adapter.on('participantJoined', (participant: RemoteParticipant) => joined.push(participant.identity));
      adapter.on('participantLeft', (participant: RemoteParticipant) => left.push(participant.identity));

      socket.receive({ type: 'participant.joined', participant: { id: 'bob' } });
      await flush();
      socket.receive({ type: 'participant.left', participant: { id: 'bob' } });
      await flush();

      expect(joined).toEqual(['bob']);
      expect(left).toEqual(['bob']);
      expect(adapter.remoteParticipants.has('bob')).toBe(false);
    });

    it('subscribes a track announced before its media arrives', async () => {
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const pc = await receiveOffer(socket);

      const subscribed: { kind: TrackKind; from: string }[] = [];
      adapter.on('trackSubscribed', (track: RemoteTrack, participant: RemoteParticipant) =>
        subscribed.push({ kind: track.kind, from: participant.identity }),
      );

      socket.receive({
        type: 'track.published',
        participantId: 'bob',
        track: { trackId: 'bob-cam', kind: 'video', source: 'camera', muted: false, simulcast: false },
      });
      await flush();
      pc.emitTrack(new FakeMediaStreamTrack('video', 'bob-cam'));
      await flush();

      expect(subscribed).toEqual([{ kind: 'camera', from: 'bob' }]);
      expect(adapter.remoteParticipants.get('bob')?.tracks).toHaveLength(1);
    });

    /**
     * The regression that quietly stopped browser-to-browser subscriptions
     * ever completing.
     *
     * `RTCTrackEvent.track.id` is not the remote track id. Chrome mints a
     * fresh local one and ignores the `msid` entirely. Matching on it meant
     * every arriving track got parked as "media arrived early" and no
     * subscription ever finished. And it failed in silence rather than
     * loudly, which is why nothing but a real browser caught it.
     */
    it('matches an arriving track by its SDP msid, not by the local track id the browser minted', async () => {
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const pc = await receiveOffer(
        socket,
        offerWithMsid([{ mid: '1', streamId: 'bob-stream', trackId: 'bob-cam' }]),
      );

      const subscribed: Array<{ kind: string; from: string }> = [];
      adapter.on('trackSubscribed', (track: RemoteTrack, participant: RemoteParticipant) =>
        subscribed.push({ kind: track.kind, from: participant.identity }),
      );

      socket.receive({
        type: 'track.published',
        participantId: 'bob',
        track: { trackId: 'bob-cam', kind: 'video', source: 'camera', muted: false, simulcast: false },
      });
      await flush();

      // Chrome's actual behaviour. The arriving track's own id has nothing
      // whatsoever to do with what the SFU labelled it.
      pc.emitTrack(new FakeMediaStreamTrack('video', 'chrome-minted-local-id'), '1');
      await flush();

      expect(subscribed).toEqual([{ kind: 'camera', from: 'bob' }]);
    });

    it('picks the right m-section when a publisher has two video tracks', async () => {
      // A camera and a screen share are both video, so scanning every
      // `a=msid:` line rather than the transceiver's own m-section ends up
      // labelling a screen share as somebody's face.
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const pc = await receiveOffer(
        socket,
        offerWithMsid([
          { mid: '0', streamId: 'bob-stream', trackId: 'bob-cam' },
          { mid: '1', streamId: 'bob-stream', trackId: 'bob-screen' },
        ]),
      );

      const subscribed: Array<{ kind: string; from: string }> = [];
      adapter.on('trackSubscribed', (track: RemoteTrack, participant: RemoteParticipant) =>
        subscribed.push({ kind: track.kind, from: participant.identity }),
      );

      for (const track of [
        { trackId: 'bob-cam', source: 'camera' },
        { trackId: 'bob-screen', source: 'screenShare' },
      ]) {
        socket.receive({
          type: 'track.published',
          participantId: 'bob',
          track: { ...track, kind: 'video', muted: false, simulcast: false },
        });
      }
      await flush();

      pc.emitTrack(new FakeMediaStreamTrack('video', 'local-a'), '1');
      await flush();

      expect(subscribed).toEqual([{ kind: 'screenShare', from: 'bob' }]);
    });

    it('falls back to the local track id when the SDP carries no msid', async () => {
      // A stack reporting no mid, or an offer with no msid, still has to
      // work instead of dropping the track. The fallback is the old
      // behaviour, and that's correct wherever the ids do agree.
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const pc = await receiveOffer(socket);

      const subscribed: string[] = [];
      adapter.on('trackSubscribed', (_track: RemoteTrack, participant: RemoteParticipant) =>
        subscribed.push(participant.identity),
      );

      socket.receive({
        type: 'track.published',
        participantId: 'bob',
        track: { trackId: 'bob-cam', kind: 'video', source: 'camera', muted: false, simulcast: false },
      });
      await flush();
      pc.emitTrack(new FakeMediaStreamTrack('video', 'bob-cam'));
      await flush();

      expect(subscribed).toEqual(['bob']);
    });

    it('subscribes a track whose media arrives before its announcement', async () => {
      // `ontrack` and `track.published` race and either can win. A
      // subscription that only worked in one order would drop tracks at
      // random.
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const pc = await receiveOffer(socket);

      const subscribed: string[] = [];
      adapter.on('trackSubscribed', (_track: RemoteTrack, participant: RemoteParticipant) =>
        subscribed.push(participant.identity),
      );

      pc.emitTrack(new FakeMediaStreamTrack('video', 'bob-cam'));
      await flush();
      expect(subscribed).toEqual([]);

      socket.receive({
        type: 'track.published',
        participantId: 'bob',
        track: { trackId: 'bob-cam', kind: 'video', source: 'camera', muted: false, simulcast: false },
      });
      await flush();

      expect(subscribed).toEqual(['bob']);
    });

    it('reports a screen share as a screen share, not a camera', async () => {
      // The whole reason the source gets declared over signaling. Both are
      // video, and codec kind can't tell them apart (spec §16).
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const pc = await receiveOffer(socket);

      let kind: TrackKind | undefined;
      adapter.on('trackSubscribed', (track: RemoteTrack) => {
        kind = track.kind;
      });

      socket.receive({
        type: 'track.published',
        participantId: 'bob',
        track: { trackId: 'bob-screen', kind: 'video', source: 'screenShare', muted: false, simulcast: false },
      });
      await flush();
      pc.emitTrack(new FakeMediaStreamTrack('video', 'bob-screen'));
      await flush();

      expect(kind).toBe('screenShare');
    });

    it('reflects the publisher\'s mute, not the browser\'s data-arrival flag', async () => {
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const pc = await receiveOffer(socket);

      let track: RemoteTrack | undefined;
      adapter.on('trackSubscribed', (subscribed: RemoteTrack) => {
        track = subscribed;
      });
      const muteEvents: string[] = [];
      adapter.on('trackMuted', () => muteEvents.push('muted'));
      adapter.on('trackUnmuted', () => muteEvents.push('unmuted'));

      socket.receive({
        type: 'track.published',
        participantId: 'bob',
        track: { trackId: 'bob-cam', kind: 'video', source: 'camera', muted: false, simulcast: false },
      });
      await flush();
      pc.emitTrack(new FakeMediaStreamTrack('video', 'bob-cam'));
      await flush();

      expect(track?.isMuted).toBe(false);

      socket.receive({ type: 'track.muted', participantId: 'bob', trackId: 'bob-cam' });
      await flush();
      expect(track?.isMuted).toBe(true);

      socket.receive({ type: 'track.unmuted', participantId: 'bob', trackId: 'bob-cam' });
      await flush();
      expect(track?.isMuted).toBe(false);
      expect(muteEvents).toEqual(['muted', 'unmuted']);
    });

    it('drops a departed participant\'s tracks without waiting for the browser', async () => {
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const pc = await receiveOffer(socket);

      socket.receive({
        type: 'track.published',
        participantId: 'bob',
        track: { trackId: 'bob-cam', kind: 'video', source: 'camera', muted: false, simulcast: false },
      });
      await flush();
      pc.emitTrack(new FakeMediaStreamTrack('video', 'bob-cam'));
      await flush();

      const unsubscribed: string[] = [];
      adapter.on('trackUnsubscribed', (_track: RemoteTrack, participant: RemoteParticipant) =>
        unsubscribed.push(participant.identity),
      );

      socket.receive({ type: 'participant.left', participant: { id: 'bob' } });
      await flush();

      expect(unsubscribed).toEqual(['bob']);
    });

    it('reconciles the room on rejoin instead of duplicating participants', async () => {
      // A reconnect re-runs the join, so the participant list turns up all
      // over again. Append it and every tile in the UI doubles.
      const { adapter, socket } = await connectAdapter({ participants: [{ id: 'bob' }] });
      const events: string[] = [];
      adapter.on('participantJoined', (p: RemoteParticipant) => events.push(`+${p.identity}`));
      adapter.on('participantLeft', (p: RemoteParticipant) => events.push(`-${p.identity}`));

      socket.receive({
        type: 'room.joined',
        roomId: 'room-1',
        participants: [{ id: 'bob' }, { id: 'carol' }],
      });
      await flush();

      // bob was already known and stays put. carol is new.
      expect(events).toEqual(['+carol']);
      expect([...adapter.remoteParticipants.keys()].sort()).toEqual(['bob', 'carol']);
    });
  });

  describe('publishing', () => {
    it('declares the track source, adds it, and offers', async () => {
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      const track = await adapter.enableCamera(true);
      await flush();

      expect(track?.kind).toBe('camera');
      expect(pc.addedTracks).toHaveLength(1);
      expect(socket.lastSent('track.publish')).toMatchObject({ source: 'camera' });
      expect(socket.lastSent('sdp.offer')).toMatchObject({ sdp: 'v=0 fake-client-offer' });
    });

    it('configures three simulcast layers for a camera', async () => {
      // Spec §15. Quarter-pixel steps, which is the ladder browsers
      // actually implement well.
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      await adapter.enableCamera(true);
      await flush();

      const sender = FakeRTCPeerConnection.latest.senders[0];
      const encodings = sender.setParametersCalls[0]?.encodings;
      expect(encodings?.map((encoding) => encoding.rid)).toEqual(['low', 'medium', 'high']);
    });

    it('does not simulcast a screen share', async () => {
      // Screen content is usually text, and dropping resolution wrecks
      // legibility in a way it never does for a face.
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      await adapter.enableScreenShare(true);
      await flush();

      expect(FakeRTCPeerConnection.latest.senders[0].setParametersCalls).toHaveLength(0);
    });

    it('does not simulcast audio', async () => {
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      await adapter.enableMicrophone(true);
      await flush();

      expect(FakeRTCPeerConnection.latest.senders[0].setParametersCalls).toHaveLength(0);
    });

    it('unmutes an already-published track rather than capturing again', async () => {
      // A second getUserMedia on the same device is slower, and on some
      // platforms it just fails.
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      const first = await adapter.enableCamera(true);
      await first?.mute();
      const second = await adapter.enableCamera(true);
      await flush();

      expect(second).toBe(first);
      expect(pc.addedTracks).toHaveLength(1);
      expect(first?.isMuted).toBe(false);
      expect(socket.lastSent('track.mute')).toMatchObject({ muted: false });
    });

    it('stops the device and renegotiates when disabled', async () => {
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      const track = await adapter.enableCamera(true);
      await flush();
      const mediaStreamTrack = track!.mediaStreamTrack as unknown as FakeMediaStreamTrack;

      await adapter.enableCamera(false);
      await flush();

      expect(mediaStreamTrack.stopped).toBe(true);
      expect(pc.removedSenders).toHaveLength(1);
      expect(adapter.localParticipant.tracks).toHaveLength(0);
    });

    it('unpublishes when the user stops a screen share from the browser bar', async () => {
      // The track simply ends and nothing tells the application. Leave it
      // published and everyone else stares at a frozen last frame.
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      const track = await adapter.enableScreenShare(true);
      await flush();

      const unpublished: string[] = [];
      adapter.on('localTrackUnpublished', (unpublishedTrack) => unpublished.push(unpublishedTrack.kind));

      (track!.mediaStreamTrack as unknown as FakeMediaStreamTrack).end();
      await flush();

      expect(unpublished).toEqual(['screenShare']);
    });

    it('defers an offer while the server has one in flight', async () => {
      // Two offers on one PeerConnection is glare. The server refuses
      // ours, so deferring skips the round trip altogether.
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);
      pc.signalingState = 'have-remote-offer';

      await adapter.enableCamera(true);
      await flush();

      expect(socket.lastSent('sdp.offer')).toBeUndefined();

      // Answering the server's next offer puts us back to stable and
      // flushes the deferred publish.
      pc.signalingState = 'stable';
      socket.receive({ type: 'sdp.offer', sdp: 'v=0 second-server-offer' });
      await flush();
      await flush();

      expect(socket.lastSent('sdp.offer')).toMatchObject({ sdp: 'v=0 fake-client-offer' });
    });

    it('refuses to publish a track it did not create', async () => {
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      const foreign = {
        kind: 'camera' as TrackKind,
        mediaStreamTrack: new FakeMediaStreamTrack('video', 'foreign'),
        delegate: {},
      };

      await expect(adapter.publish(foreign as never)).rejects.toBeInstanceOf(RTCError);
    });
  });

  describe('data channel', () => {
    it('opens a channel on demand and sends the payload', async () => {
      // Not opened at connect. A channel costs an SCTP association and
      // most calls never send a byte.
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);
      expect(pc.dataChannels).toHaveLength(0);

      await adapter.sendData(new TextEncoder().encode('hello') as Uint8Array<ArrayBuffer>);

      expect(pc.dataChannels).toHaveLength(1);
      expect(pc.dataChannels[0].label).toBe('raven-data');
      expect(pc.dataChannels[0].sent).toHaveLength(1);
    });

    it('rejects a payload over the size limit', async () => {
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      const tooBig = new Uint8Array(64 * 1024 + 1) as Uint8Array<ArrayBuffer>;
      await expect(adapter.sendData(tooBig)).rejects.toMatchObject({ code: 'MEDIA_ERROR' });
    });

    it('emits data the SFU forwarded, with no attributed sender', async () => {
      // The transport carries no sender identity at all, since the SFU
      // fans data out over each recipient's own channel. Attributing it
      // would mean trusting a field the sender controls.
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      const received: { payload: Uint8Array; from?: RemoteParticipant }[] = [];
      adapter.on('dataReceived', (payload, from) => received.push({ payload, from }));

      const channel = pc.emitDataChannel('raven-data');
      channel.receive(new TextEncoder().encode('ping').buffer as ArrayBuffer);

      expect(received).toHaveLength(1);
      expect(new TextDecoder().decode(received[0].payload)).toBe('ping');
      expect(received[0].from).toBeUndefined();
    });

    it('ignores a channel with an unexpected label', async () => {
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);

      const received: unknown[] = [];
      adapter.on('dataReceived', (payload) => received.push(payload));

      const channel = pc.emitDataChannel('someone-elses-channel');
      channel.receive(new TextEncoder().encode('nope').buffer as ArrayBuffer);

      expect(received).toHaveLength(0);
    });
  });

  describe('connection quality', () => {
    it('reports unknown rather than inventing a verdict', async () => {
      // The SFU has the vantage point no client can get, and doesn't
      // compute this yet. A client-side guess dressed up as a server
      // verdict is precisely the fabricated metric spec §19 forbids.
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);
      pc.setConnectionState('connected');

      expect(adapter.getConnectionQuality()).toBe('unknown');
    });

    it('reports lost when the SFU says the connection failed', async () => {
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      socket.receive({ type: 'connection.state', iceState: 'failed', peerState: 'failed' });
      await flush();

      expect(adapter.getConnectionQuality()).toBe('lost');
    });

    it('exposes ICE and signaling state, which the previous adapter could not', async () => {
      // `Room.getDiagnostics()` reported these as undefined for as long as
      // LiveKit owned the connection. Raven's own adapter has the peer
      // connection right there. These are the states that actually explain
      // a failed connection in a bug report.
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);
      pc.iceConnectionState = 'checking';

      expect(adapter.getIceConnectionState()).toBe('checking');
      expect(adapter.getSignalingState()).toBe('stable');
    });

    it('reports nothing rather than guessing before a connection exists', async () => {
      const adapter = new RavenAdapter(createLogger('silent'), false);

      expect(adapter.getIceConnectionState()).toBeUndefined();
      expect(adapter.getSignalingState()).toBeUndefined();
      expect(adapter.getRemoteConnectionState()).toEqual({
        iceState: undefined,
        peerState: undefined,
      });
    });

    it('surfaces the SFU\'s view alongside the local one', async () => {
      // The two can disagree, and the disagreement is the useful bit.
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      socket.receive({ type: 'connection.state', iceState: 'connected', peerState: 'connected' });
      await flush();

      expect(adapter.getRemoteConnectionState()).toEqual({
        iceState: 'connected',
        peerState: 'connected',
      });
    });
  });

  describe('disconnecting', () => {
    it('stops local media, leaves the room, and closes the connection', async () => {
      const { adapter, socket } = await connectAdapter();
      const pc = await receiveOffer(socket);
      const track = await adapter.enableCamera(true);
      await flush();

      await adapter.disconnect();

      expect((track!.mediaStreamTrack as unknown as FakeMediaStreamTrack).stopped).toBe(true);
      expect(socket.lastSent('room.leave')).toBeDefined();
      expect(pc.closed).toBe(true);
      expect(adapter.connectionState).toBe('disconnected');
      expect(adapter.localParticipant.tracks).toHaveLength(0);
      expect(adapter.remoteParticipants.size).toBe(0);
    });

    it('does not report a failure for a deliberate disconnect', async () => {
      const { adapter, socket } = await connectAdapter();
      await receiveOffer(socket);

      const states: string[] = [];
      adapter.on('connectionStateChanged', (state) => states.push(state));

      await adapter.disconnect();
      await flush();

      expect(states).not.toContain('failed');
      expect(states.at(-1)).toBe('disconnected');
    });
  });

  describe('reconnection', () => {
    it('tears down the old PeerConnection when reconnecting', async () => {
      // The server allocates a fresh session on rejoin, so the old
      // connection is no use to anyone. Leave it open and a caller can
      // find a connection that looks alive and forwards nothing.
      const { adapter, socket } = await connectAdapter({ autoReconnect: true });
      const pc = await receiveOffer(socket);
      pc.setConnectionState('connected');

      socket.close(1006);
      await flush();

      expect(pc.closed).toBe(true);
      expect(adapter.connectionState).toBe('reconnecting');
    });

    it('fails immediately when autoReconnect is off', async () => {
      const { adapter, socket } = await connectAdapter({ autoReconnect: false });
      const pc = await receiveOffer(socket);
      pc.setConnectionState('connected');

      const failures: RTCError[] = [];
      adapter.on('connectionStateChanged', (state) => {
        if (state === 'failed') failures.push(new RTCError('CONNECTION_FAILED', state));
      });

      socket.close(1006);
      await flush();

      expect(adapter.connectionState).toBe('failed');
    });
  });
});
