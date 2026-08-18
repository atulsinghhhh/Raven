import { HttpStatus } from '@nestjs/common';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { ChatError } from './chat-error';
import { ChatErrorCode, ChatServerFrame } from './chat.constants';

function bodyOf(error: ChatError): Record<string, unknown> {
  return error.getResponse() as Record<string, unknown>;
}

describe('ChatError', () => {
  describe('the WebSocket frame', () => {
    // docs/chat/websocket.md is a published protocol and @raven/chat maps
    // these codes today. Adding canonical codes to the HTTP body must not
    // reach the frame — every connected client would break at once.
    it('still carries the chat code, not the canonical one', () => {
      const frame = new ChatError(ChatErrorCode.MESSAGE_TOO_LARGE, 'too big').toFrame();

      expect(frame.code).toBe('MESSAGE_TOO_LARGE');
      expect(frame.type).toBe(ChatServerFrame.ERROR);
    });

    it('never leaks a RAVEN_ prefix onto the wire protocol', () => {
      for (const code of Object.values(ChatErrorCode)) {
        expect(new ChatError(code, 'x').toFrame().code.startsWith('RAVEN_')).toBe(false);
      }
    });

    it('echoes the correlation id so a client can match a reply to its request', () => {
      expect(new ChatError(ChatErrorCode.INVALID_MESSAGE, 'x').toFrame('c-1').id).toBe('c-1');
    });

    it('omits the correlation id entirely when there is none', () => {
      // An `id: undefined` key would serialise differently from its absence.
      expect('id' in new ChatError(ChatErrorCode.INVALID_MESSAGE, 'x').toFrame()).toBe(false);
    });
  });

  describe('the HTTP body', () => {
    it('carries the canonical code so one switch handles the whole API', () => {
      const error = new ChatError(ChatErrorCode.MESSAGE_NOT_FOUND, 'gone');

      expect(bodyOf(error).code).toBe(RavenErrorCode.MESSAGE_NOT_FOUND);
      expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });

    it('maps a missing conversation to the conversation code, not the room one', () => {
      // ROOM_NOT_FOUND is the chat plane's name for it; over HTTP the
      // resource really is a conversation, and RAVEN_ROOM_NOT_FOUND means
      // an RTC room.
      expect(bodyOf(new ChatError(ChatErrorCode.ROOM_NOT_FOUND, 'x')).code).toBe(
        RavenErrorCode.CONVERSATION_NOT_FOUND,
      );
    });

    it.each([
      [ChatErrorCode.TOKEN_EXPIRED, RavenErrorCode.TOKEN_EXPIRED],
      [ChatErrorCode.INVALID_TOKEN, RavenErrorCode.AUTH_ERROR],
      [ChatErrorCode.TOKEN_REVOKED, RavenErrorCode.AUTH_ERROR],
      [ChatErrorCode.PERMISSION_DENIED, RavenErrorCode.PERMISSION_DENIED],
      [ChatErrorCode.NOT_A_MEMBER, RavenErrorCode.PERMISSION_DENIED],
      [ChatErrorCode.RATE_LIMITED, RavenErrorCode.RATE_LIMITED],
      [ChatErrorCode.ATTACHMENT_TOO_LARGE, RavenErrorCode.ATTACHMENT_TOO_LARGE],
      [ChatErrorCode.MESSAGE_TOO_LARGE, RavenErrorCode.MESSAGE_TOO_LARGE],
      [ChatErrorCode.INVALID_CURSOR, RavenErrorCode.INVALID_CURSOR],
      [ChatErrorCode.ATTACHMENTS_NOT_CONFIGURED, RavenErrorCode.NOT_CONFIGURED],
      [ChatErrorCode.INTERNAL_ERROR, RavenErrorCode.INTERNAL_ERROR],
    ])('maps %s to %s', (chatCode, ravenCode) => {
      expect(bodyOf(new ChatError(chatCode, 'x')).code).toBe(ravenCode);
    });

    it('keeps an expired token distinguishable from a rejected one', () => {
      // The client should refresh on one and stop retrying on the other, so
      // collapsing both into AUTH_ERROR would cost real behaviour.
      const expired = bodyOf(new ChatError(ChatErrorCode.TOKEN_EXPIRED, 'x')).code;
      const invalid = bodyOf(new ChatError(ChatErrorCode.INVALID_TOKEN, 'x')).code;

      expect(expired).not.toBe(invalid);
    });

    it('gives every chat code a canonical code', () => {
      for (const code of Object.values(ChatErrorCode)) {
        expect(String(bodyOf(new ChatError(code, 'x')).code).startsWith('RAVEN_')).toBe(true);
      }
    });

    it('keeps the message and attachment size limits distinguishable', () => {
      // They are configured independently, so "shrink it" is not actionable
      // until the developer knows which limit they crossed.
      const message = bodyOf(new ChatError(ChatErrorCode.MESSAGE_TOO_LARGE, 'x')).code;
      const attachment = bodyOf(new ChatError(ChatErrorCode.ATTACHMENT_TOO_LARGE, 'x')).code;

      expect(message).not.toBe(attachment);
    });

    it('reports the pre-prefix chat code as legacyCode, not a generic one', () => {
      // A client mid-migration was reading INVALID_CURSOR. Handing it
      // VALIDATION_FAILED would break the very callers the field protects.
      expect(bodyOf(new ChatError(ChatErrorCode.INVALID_CURSOR, 'x')).legacyCode).toBe(
        'INVALID_CURSOR',
      );
    });

    it('reports retryAfterSeconds on both surfaces when rate limited', () => {
      const error = new ChatError(ChatErrorCode.RATE_LIMITED, 'slow down', 12);

      expect(bodyOf(error).retryAfterSeconds).toBe(12);
      expect(error.toFrame().retryAfterSeconds).toBe(12);
    });
  });
});
