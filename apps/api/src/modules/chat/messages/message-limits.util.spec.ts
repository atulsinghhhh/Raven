import { MessageType } from '../../../generated/prisma/client';
import { ChatError } from '../chat-error';
import {
  ChatLimits,
  assertMessageBodyPresent,
  assertMessageTypeAllowed,
  assertMetadataWithinLimits,
  assertTextWithinLimits,
} from './message-limits.util';

const limits: ChatLimits = {
  maxTextLength: 10,
  maxMetadataBytes: 32,
  maxFrameBytes: 1024,
  maxReactionsPerMessage: 5,
  maxHistoryPageSize: 100,
};

describe('assertTextWithinLimits', () => {
  it('accepts text at exactly the limit', () => {
    expect(() => assertTextWithinLimits('0123456789', limits)).not.toThrow();
  });

  it('rejects text one character over', () => {
    expect(() => assertTextWithinLimits('01234567890', limits)).toThrow(
      expect.objectContaining({ chatCode: 'MESSAGE_TOO_LARGE' }),
    );
  });

  it('counts code points, not UTF-16 units', () => {
    // "🙂".length is 2 in JavaScript. Telling someone their 6-emoji
    // message is 12 characters long would be wrong and confusing.
    expect(() => assertTextWithinLimits('🙂'.repeat(10), limits)).not.toThrow();
    expect(() => assertTextWithinLimits('🙂'.repeat(11), limits)).toThrow(ChatError);
  });

  it('reports the real length in the message so the developer can act on it', () => {
    expect(() => assertTextWithinLimits('x'.repeat(15), limits)).toThrow(/15 characters.*limit is 10/);
  });

  it('treats null and undefined as "no text", not as an error', () => {
    expect(() => assertTextWithinLimits(null, limits)).not.toThrow();
    expect(() => assertTextWithinLimits(undefined, limits)).not.toThrow();
  });

  it('rejects a non-string', () => {
    expect(() => assertTextWithinLimits(42 as unknown as string, limits)).toThrow(
      expect.objectContaining({ chatCode: 'INVALID_MESSAGE' }),
    );
  });
});

describe('assertMetadataWithinLimits', () => {
  it('accepts small metadata', () => {
    expect(() => assertMetadataWithinLimits({ a: 1 }, limits)).not.toThrow();
  });

  it('rejects metadata over the byte budget', () => {
    expect(() => assertMetadataWithinLimits({ key: 'x'.repeat(100) }, limits)).toThrow(
      expect.objectContaining({ chatCode: 'MESSAGE_TOO_LARGE' }),
    );
  });

  it('measures bytes, not characters — multibyte JSON is bigger than it looks', () => {
    // 8 emoji serialize to well over 32 bytes even though the object
    // looks short.
    expect(() => assertMetadataWithinLimits({ e: '🙂'.repeat(8) }, limits)).toThrow(ChatError);
  });

  it('rejects an array, which is JSON but not a metadata object', () => {
    expect(() => assertMetadataWithinLimits([] as unknown as Record<string, unknown>, limits)).toThrow(
      expect.objectContaining({ chatCode: 'INVALID_MESSAGE' }),
    );
  });

  it('allows absent metadata', () => {
    expect(() => assertMetadataWithinLimits(undefined, limits)).not.toThrow();
    expect(() => assertMetadataWithinLimits(null, limits)).not.toThrow();
  });
});

describe('assertMessageBodyPresent', () => {
  it('requires text on a text message', () => {
    expect(() => assertMessageBodyPresent(MessageType.TEXT, '', null)).toThrow(ChatError);
    expect(() => assertMessageBodyPresent(MessageType.TEXT, '   ', null)).toThrow(ChatError);
    expect(() => assertMessageBodyPresent(MessageType.TEXT, 'hello', null)).not.toThrow();
  });

  it('requires an attachment on an attachment message', () => {
    expect(() => assertMessageBodyPresent(MessageType.ATTACHMENT, null, null)).toThrow(ChatError);
    expect(() => assertMessageBodyPresent(MessageType.ATTACHMENT, null, 'att_1')).not.toThrow();
  });

  it('lets event messages carry no body at all', () => {
    expect(() => assertMessageBodyPresent(MessageType.EVENT, null, null)).not.toThrow();
  });
});

describe('assertMessageTypeAllowed', () => {
  it('lets a browser send text and attachments', () => {
    expect(() => assertMessageTypeAllowed(MessageType.TEXT, 'client')).not.toThrow();
    expect(() => assertMessageTypeAllowed(MessageType.ATTACHMENT, 'client')).not.toThrow();
  });

  it('stops a browser forging a system message', () => {
    // Otherwise any user could render themselves a convincing
    // "You have been promoted to admin" banner in someone else's chat.
    expect(() => assertMessageTypeAllowed(MessageType.SYSTEM, 'client')).toThrow(
      expect.objectContaining({ chatCode: 'PERMISSION_DENIED' }),
    );
    expect(() => assertMessageTypeAllowed(MessageType.EVENT, 'client')).toThrow(ChatError);
  });

  it('allows every type server-side', () => {
    for (const type of Object.values(MessageType)) {
      expect(() => assertMessageTypeAllowed(type, 'server')).not.toThrow();
    }
  });
});
