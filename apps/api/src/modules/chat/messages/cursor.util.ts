import { ChatError } from '../chat-error';
import { ChatErrorCode } from '../chat.constants';

export interface MessageCursor {
  createdAt: Date;
  /** The message's PUBLIC id (`msg_...`), never the internal uuid — see below. */
  publicId: string;
}

/**
 * Keyset pagination, not OFFSET (spec §17). `OFFSET 50000` makes Postgres
 * walk and discard 50 000 rows on every page; `(createdAt, publicId) < (?, ?)`
 * is an index seek regardless of depth. It's also stable: messages
 * arriving mid-scroll can't shift rows across page boundaries the way an
 * offset would.
 *
 * The tiebreaker matters — two messages can share a millisecond, and
 * `createdAt` alone would silently skip or repeat one of them.
 *
 * The cursor is opaque base64 so the shape stays ours to change, and so
 * it doesn't read as something a caller should assemble by hand. It
 * carries the message's *public* id, not the internal uuid — base64 is
 * encoding, not encryption, and a cursor that decodes to a database
 * primary key would leak exactly the internal identifier §57 says never
 * to expose.
 */
export function encodeCursor(cursor: MessageCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.publicId}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): MessageCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new ChatError(ChatErrorCode.INVALID_CURSOR, 'Cursor is malformed');
  }

  const separator = decoded.indexOf('|');
  if (separator === -1) {
    throw new ChatError(ChatErrorCode.INVALID_CURSOR, 'Cursor is malformed');
  }

  const createdAt = new Date(decoded.slice(0, separator));
  const publicId = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !publicId) {
    throw new ChatError(ChatErrorCode.INVALID_CURSOR, 'Cursor is malformed');
  }

  return { createdAt, publicId };
}

/**
 * The row-value comparison Prisma can't express directly. Expands
 * `(createdAt, publicId) < (c.createdAt, c.publicId)` into the OR form.
 *
 * The range half is served by the `(conversationId, createdAt, ...)`
 * index; the `publicId` half only ever applies to the handful of rows
 * sharing an exact timestamp, so it costs nothing in practice while
 * keeping pagination stable when two messages land in the same
 * millisecond.
 */
export function cursorFilter(cursor: MessageCursor, direction: 'before' | 'after') {
  const comparison = direction === 'before' ? 'lt' : 'gt';
  return {
    OR: [
      { createdAt: { [comparison]: cursor.createdAt } },
      { createdAt: cursor.createdAt, publicId: { [comparison]: cursor.publicId } },
    ],
  };
}
