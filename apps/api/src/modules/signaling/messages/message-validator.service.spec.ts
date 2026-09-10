import { ConfigService } from '@nestjs/config';
import { SignalingError } from '../signaling-error';
import { ClientMessageType, SignalingErrorCode } from '../signaling.constants';
import { MessageValidatorService } from './message-validator.service';

describe('MessageValidatorService', () => {
  let validator: MessageValidatorService;
  let maxBytes: number;

  beforeEach(() => {
    maxBytes = 16_384;
    const configService = { get: jest.fn(() => maxBytes) } as unknown as ConfigService;
    validator = new MessageValidatorService(configService);
  });

  function expectRejects(raw: string, code: SignalingErrorCode) {
    expect(() => validator.parse(raw)).toThrow(SignalingError);
    try {
      validator.parse(raw);
    } catch (err) {
      expect((err as SignalingError).code).toBe(code);
    }
  }

  it('rejects invalid JSON', () => {
    expectRejects('{not json', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('rejects a JSON array (not an object)', () => {
    expectRejects('[]', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('rejects a message with no type field', () => {
    expectRejects('{"roomId":"room-1"}', SignalingErrorCode.INVALID_MESSAGE_TYPE);
  });

  it('rejects an unknown message type', () => {
    expectRejects('{"type":"totally.unknown"}', SignalingErrorCode.INVALID_MESSAGE_TYPE);
  });

  it('rejects an oversized message', () => {
    maxBytes = 10;
    expectRejects('{"type":"ping","padding":"aaaaaaaaaaaaaaaaaaaaaaaa"}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('accepts room.join with no roomId', () => {
    const msg = validator.parse('{"type":"room.join"}');
    expect(msg).toEqual({ type: ClientMessageType.ROOM_JOIN, roomId: undefined });
  });

  it('accepts room.join with a roomId', () => {
    const msg = validator.parse('{"type":"room.join","roomId":"room-123"}');
    expect(msg).toEqual({ type: ClientMessageType.ROOM_JOIN, roomId: 'room-123', region: undefined });
  });

  it('accepts room.join with a preferred region', () => {
    const msg = validator.parse('{"type":"room.join","region":"asia-south"}');
    expect(msg).toEqual({
      type: ClientMessageType.ROOM_JOIN,
      roomId: undefined,
      region: 'asia-south',
    });
  });

  it('rejects room.join with a non-string roomId', () => {
    expectRejects('{"type":"room.join","roomId":123}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('rejects room.join with a non-string region', () => {
    expectRejects('{"type":"room.join","region":42}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('accepts an sdp.offer with no target', () => {
    // The client has exactly one peer: the SFU serving its room. A
    // `targetParticipantId` was the defining field of the mesh protocol
    // this replaced, and requiring one now would be wrong.
    const msg = validator.parse('{"type":"sdp.offer","sdp":"v=0..."}');
    expect(msg).toEqual({ type: ClientMessageType.SDP_OFFER, sdp: 'v=0...' });
  });

  it('ignores a targetParticipantId if a stale client still sends one', () => {
    const msg = validator.parse('{"type":"sdp.answer","targetParticipantId":"bob","sdp":"v=0..."}');
    expect(msg).toEqual({ type: ClientMessageType.SDP_ANSWER, sdp: 'v=0...' });
  });

  it('rejects sdp.offer missing sdp', () => {
    expectRejects('{"type":"sdp.offer"}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('rejects sdp.answer missing sdp', () => {
    expectRejects('{"type":"sdp.answer"}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('accepts a well-formed ice.candidate', () => {
    const msg = validator.parse(
      '{"type":"ice.candidate","candidate":"candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"abc"}',
    );
    expect(msg).toEqual({
      type: ClientMessageType.ICE_CANDIDATE,
      candidate: 'candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'abc',
    });
  });

  it('accepts an ice.candidate with only the candidate line', () => {
    // sdpMid/sdpMLineIndex are optional in WebRTC; a browser may send
    // either or neither.
    const msg = validator.parse('{"type":"ice.candidate","candidate":"candidate:1 1 udp ..."}');
    expect(msg).toMatchObject({ type: ClientMessageType.ICE_CANDIDATE });
  });

  it('rejects ice.candidate missing the candidate field', () => {
    expectRejects('{"type":"ice.candidate","sdpMid":"0"}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('rejects ice.candidate whose candidate is an object', () => {
    // The mesh protocol carried an opaque object here; the SFU protocol
    // carries the candidate line as a string.
    expectRejects('{"type":"ice.candidate","candidate":{"candidate":"..."}}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('rejects a non-integer sdpMLineIndex', () => {
    expectRejects(
      '{"type":"ice.candidate","candidate":"candidate:1","sdpMLineIndex":1.5}',
      SignalingErrorCode.INVALID_MESSAGE,
    );
  });

  it('accepts a well-formed track.mute', () => {
    const msg = validator.parse('{"type":"track.mute","trackId":"cam-1","muted":true}');
    expect(msg).toEqual({ type: ClientMessageType.TRACK_MUTE, trackId: 'cam-1', muted: true });
  });

  it('rejects track.mute without an explicit boolean', () => {
    // "muted": "true" from a hand-rolled client must not read as muted.
    expectRejects('{"type":"track.mute","trackId":"cam-1","muted":"true"}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('accepts a well-formed subscription.update', () => {
    const msg = validator.parse('{"type":"subscription.update","publisherId":"bob","trackId":"bob-cam","layer":"low"}');
    expect(msg).toEqual({
      type: ClientMessageType.SUBSCRIPTION_UPDATE,
      publisherId: 'bob',
      trackId: 'bob-cam',
      layer: 'low',
    });
  });

  it('accepts layer "auto"', () => {
    const msg = validator.parse('{"type":"subscription.update","publisherId":"bob","trackId":"c","layer":"auto"}');
    expect(msg).toMatchObject({ layer: 'auto' });
  });

  it('rejects an unknown simulcast layer rather than defaulting it', () => {
    // Silently substituting a different quality would hide a client bug.
    expectRejects(
      '{"type":"subscription.update","publisherId":"bob","trackId":"c","layer":"ultra"}',
      SignalingErrorCode.INVALID_MESSAGE,
    );
  });

  it('rejects subscription.update missing publisherId', () => {
    expectRejects('{"type":"subscription.update","trackId":"c","layer":"low"}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('accepts room.leave and ping with no extra fields', () => {
    expect(validator.parse('{"type":"room.leave"}')).toEqual({ type: ClientMessageType.ROOM_LEAVE });
    expect(validator.parse('{"type":"ping"}')).toEqual({ type: ClientMessageType.PING });
  });
});
