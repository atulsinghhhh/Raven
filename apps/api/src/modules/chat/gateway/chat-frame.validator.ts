import { RawData } from 'ws';
import { ChatError } from '../chat-error';
import { ChatClientFrame, ChatErrorCode } from '../chat.constants';

export interface ParsedFrame {
  type: ChatClientFrame;
  /** Client-chosen correlation id, echoed on the ack/error so a reply can be matched to a request. */
  id?: string;
  [key: string]: unknown;
}

const CLIENT_FRAME_TYPES = new Set<string>(Object.values(ChatClientFrame));

/**
 * Parses and shape-checks an inbound frame before anything else touches
 * it. Deliberately paranoid: this is the only place attacker-controlled
 * bytes enter the chat plane, and everything downstream assumes a valid
 * envelope.
 *
 * The size check happens on the raw buffer, before JSON.parse — parsing a
 * 50 MB frame to then reject it would be the denial of service.
 */
export function parseClientFrame(data: RawData, maxBytes: number): ParsedFrame {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

  if (buffer.byteLength > maxBytes) {
    throw new ChatError(
      ChatErrorCode.MESSAGE_TOO_LARGE,
      `Frame is ${buffer.byteLength} bytes — the limit is ${maxBytes}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    // Never echo the payload back; it's whatever the client sent.
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'Frame is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'Frame must be a JSON object');
  }

  const frame = parsed as Record<string, unknown>;
  if (typeof frame.type !== 'string' || !CLIENT_FRAME_TYPES.has(frame.type)) {
    throw new ChatError(
      ChatErrorCode.INVALID_MESSAGE_TYPE,
      `Unsupported frame type "${String(frame.type).slice(0, 40)}"`,
    );
  }
  if (frame.id !== undefined && (typeof frame.id !== 'string' || frame.id.length > 128)) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'Frame id must be a string of at most 128 characters');
  }

  return frame as ParsedFrame;
}

/** Reads a required string field, with a specific error rather than a downstream type crash. */
export function requireString(frame: ParsedFrame, field: string, maxLength = 256): string {
  const value = frame[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, `"${field}" is required`);
  }
  if (value.length > maxLength) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, `"${field}" is too long`);
  }
  return value;
}

export function optionalString(frame: ParsedFrame, field: string, maxLength = 256): string | undefined {
  const value = frame[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, `"${field}" must be a string of at most ${maxLength} characters`);
  }
  return value;
}
