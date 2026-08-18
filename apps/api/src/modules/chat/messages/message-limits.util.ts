import { MessageType } from '../../../generated/prisma/client';
import { ChatError } from '../chat-error';
import { ChatErrorCode } from '../chat.constants';

export interface ChatLimits {
  maxTextLength: number;
  maxMetadataBytes: number;
  maxFrameBytes: number;
  maxReactionsPerMessage: number;
  maxHistoryPageSize: number;
}

/**
 * Payload ceilings (spec §38), enforced in one place so the WebSocket and
 * HTTP paths can't drift apart — a limit that only one transport honours
 * is not a limit. Everything here is configurable via env, so a
 * deployment that genuinely needs 16 KB messages can have them without a
 * code change.
 */
export function assertTextWithinLimits(text: string | null | undefined, limits: ChatLimits): void {
  if (text == null) {
    return;
  }
  if (typeof text !== 'string') {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'text must be a string');
  }
  // Counting code points, not UTF-16 units: "🙂".length is 2, and telling
  // someone their 2 000-emoji message is 4 000 characters long is a lie.
  const length = [...text].length;
  if (length > limits.maxTextLength) {
    throw new ChatError(
      ChatErrorCode.MESSAGE_TOO_LARGE,
      `Message text is ${length} characters — the limit is ${limits.maxTextLength}`,
    );
  }
}

export function assertMetadataWithinLimits(
  metadata: Record<string, unknown> | null | undefined,
  limits: ChatLimits,
): void {
  if (metadata == null) {
    return;
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'metadata must be a JSON object');
  }
  const bytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
  if (bytes > limits.maxMetadataBytes) {
    throw new ChatError(
      ChatErrorCode.MESSAGE_TOO_LARGE,
      `metadata is ${bytes} bytes — the limit is ${limits.maxMetadataBytes}`,
    );
  }
}

/**
 * A TEXT message with no text is almost always a client bug, and storing
 * it would put an unrenderable row in someone's history. ATTACHMENT and
 * EVENT messages legitimately carry no text.
 */
export function assertMessageBodyPresent(
  type: MessageType,
  text: string | null | undefined,
  attachmentId: string | null | undefined,
): void {
  const hasText = typeof text === 'string' && text.trim().length > 0;

  if (type === MessageType.TEXT && !hasText) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'A text message needs non-empty text');
  }
  if (type === MessageType.ATTACHMENT && !attachmentId) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'An attachment message needs an attachmentId');
  }
}

/**
 * Only a project API key may post SYSTEM/EVENT messages. Otherwise any
 * browser could render itself a convincing "You have been promoted to
 * admin" banner inside someone else's chat.
 */
export function assertMessageTypeAllowed(type: MessageType, actorKind: 'server' | 'client'): void {
  if (actorKind === 'server') {
    return;
  }
  if (type === MessageType.SYSTEM || type === MessageType.EVENT) {
    throw new ChatError(
      ChatErrorCode.PERMISSION_DENIED,
      `${type.toLowerCase()} messages can only be sent server-side with a project API key`,
    );
  }
}
