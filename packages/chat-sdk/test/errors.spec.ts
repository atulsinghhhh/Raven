import {
  RavenAttachmentError,
  RavenChatAuthenticationError,
  RavenChatConnectionError,
  RavenChatError,
  RavenChatPermissionError,
  RavenMessageError,
  RavenRateLimitError,
  RavenRoomError,
  isRavenChatError,
  toRavenChatError,
} from '../src/errors';

describe('toRavenChatError', () => {
  it.each([
    ['INVALID_TOKEN', RavenChatAuthenticationError],
    ['TOKEN_EXPIRED', RavenChatAuthenticationError],
    ['TOKEN_REVOKED', RavenChatAuthenticationError],
    ['UNAUTHORIZED', RavenChatAuthenticationError],
    ['PERMISSION_DENIED', RavenChatPermissionError],
    ['NOT_A_MEMBER', RavenChatPermissionError],
    ['ROOM_NOT_FOUND', RavenRoomError],
    ['NOT_IN_ROOM', RavenRoomError],
    ['CONVERSATION_ARCHIVED', RavenRoomError],
    ['MESSAGE_TOO_LARGE', RavenMessageError],
    ['MESSAGE_NOT_FOUND', RavenMessageError],
    ['INVALID_CURSOR', RavenMessageError],
    ['ATTACHMENT_TOO_LARGE', RavenAttachmentError],
    ['ATTACHMENTS_NOT_CONFIGURED', RavenAttachmentError],
    ['CONNECTION_FAILED', RavenChatConnectionError],
    ['TIMEOUT', RavenChatConnectionError],
  ])('maps %s to the specific error class a developer would catch', (code, expected) => {
    const error = toRavenChatError(code, 'something happened');
    expect(error).toBeInstanceOf(expected);
    expect(error.code).toBe(code);
  });

  it('carries retryAfterSeconds through on a rate limit', () => {
    const error = toRavenChatError('RATE_LIMITED', 'slow down', { retryAfterSeconds: 12 });
    expect(error).toBeInstanceOf(RavenRateLimitError);
    expect((error as RavenRateLimitError).retryAfterSeconds).toBe(12);
  });

  it('falls back to the base class for a code this SDK version does not know', () => {
    const error = toRavenChatError('SOME_FUTURE_CODE', 'from a newer server');
    expect(error).toBeInstanceOf(RavenChatError);
    expect(error.code).toBe('SOME_FUTURE_CODE');
  });

  it('defaults to INTERNAL_ERROR when the server sent no code at all', () => {
    expect(toRavenChatError(undefined, 'unknown').code).toBe('INTERNAL_ERROR');
  });
});

describe('isRavenChatError', () => {
  it('recognises every subclass, so one catch covers the whole SDK', () => {
    expect(isRavenChatError(new RavenRateLimitError('x'))).toBe(true);
    expect(isRavenChatError(new RavenRoomError('x'))).toBe(true);
    expect(isRavenChatError(new Error('plain'))).toBe(false);
    expect(isRavenChatError('not an error')).toBe(false);
  });
});

describe('error surface', () => {
  it('keeps the underlying cause without exposing it in the message', () => {
    const cause = new TypeError('fetch failed: ECONNREFUSED 10.0.0.1:5432');
    const error = new RavenChatConnectionError('Could not reach Livqeno', 'NETWORK_ERROR', cause);
    expect(error.message).toBe('Could not reach Livqeno');
    expect(error.cause).toBe(cause);
  });

  it('sets a distinct name per class so stack traces and logs read clearly', () => {
    expect(new RavenChatAuthenticationError('x').name).toBe('RavenChatAuthenticationError');
    expect(new RavenRateLimitError('x').name).toBe('RavenRateLimitError');
  });
});
