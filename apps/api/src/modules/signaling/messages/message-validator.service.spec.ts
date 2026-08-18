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
    expect(msg).toEqual({ type: ClientMessageType.ROOM_JOIN, roomId: 'room-123' });
  });

  it('rejects room.join with a non-string roomId', () => {
    expectRejects('{"type":"room.join","roomId":123}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('accepts a well-formed sdp.offer', () => {
    const msg = validator.parse('{"type":"sdp.offer","targetParticipantId":"bob","sdp":"v=0..."}');
    expect(msg).toEqual({ type: ClientMessageType.SDP_OFFER, targetParticipantId: 'bob', sdp: 'v=0...' });
  });

  it('rejects sdp.offer missing targetParticipantId', () => {
    expectRejects('{"type":"sdp.offer","sdp":"v=0..."}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('rejects sdp.answer missing sdp', () => {
    expectRejects('{"type":"sdp.answer","targetParticipantId":"bob"}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('accepts a well-formed ice.candidate', () => {
    const msg = validator.parse(
      '{"type":"ice.candidate","targetParticipantId":"bob","candidate":{"candidate":"..."}}',
    );
    expect(msg).toEqual({
      type: ClientMessageType.ICE_CANDIDATE,
      targetParticipantId: 'bob',
      candidate: { candidate: '...' },
    });
  });

  it('rejects ice.candidate missing the candidate field', () => {
    expectRejects('{"type":"ice.candidate","targetParticipantId":"bob"}', SignalingErrorCode.INVALID_MESSAGE);
  });

  it('accepts room.leave and ping with no extra fields', () => {
    expect(validator.parse('{"type":"room.leave"}')).toEqual({ type: ClientMessageType.ROOM_LEAVE });
    expect(validator.parse('{"type":"ping"}')).toEqual({ type: ClientMessageType.PING });
  });
});
