import { ChatError } from '../chat-error';
import { cursorFilter, decodeCursor, encodeCursor } from './cursor.util';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cursor', () => {
    const cursor = { createdAt: new Date('2026-08-18T12:34:56.789Z'), publicId: 'msg_abc123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('never encodes an internal database id', () => {
    // base64 is encoding, not encryption: anyone can decode a cursor.
    // What comes out must be the public id, never a primary key.
    const encoded = encodeCursor({ createdAt: new Date('2026-01-01T00:00:00.000Z'), publicId: 'msg_public' });
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    expect(decoded).toBe('2026-01-01T00:00:00.000Z|msg_public');
    expect(decoded).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('produces a URL-safe string', () => {
    const encoded = encodeCursor({ createdAt: new Date(), publicId: 'msg_a/b+c=' });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it.each([
    ['not-base64-at-all!!', 'garbage'],
    ['', 'empty'],
    [Buffer.from('no-separator').toString('base64url'), 'missing separator'],
    [Buffer.from('not-a-date|msg_1').toString('base64url'), 'unparseable timestamp'],
    [Buffer.from('2026-01-01T00:00:00.000Z|').toString('base64url'), 'missing id'],
  ])('rejects a malformed cursor (%s)', (raw) => {
    expect(() => decodeCursor(raw)).toThrow(ChatError);
    expect(() => decodeCursor(raw)).toThrow(expect.objectContaining({ chatCode: 'INVALID_CURSOR' }));
  });

  it('keeps ids containing a pipe intact', () => {
    // The separator is the *first* pipe, so an id containing one still
    // round-trips, not being silently truncated.
    const cursor = { createdAt: new Date('2026-01-01T00:00:00.000Z'), publicId: 'msg_a|b' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });
});

describe('cursorFilter', () => {
  const cursor = { createdAt: new Date('2026-08-18T12:00:00.000Z'), publicId: 'msg_mid' };

  it('walks backwards for `before`', () => {
    expect(cursorFilter(cursor, 'before')).toEqual({
      OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { lt: 'msg_mid' } }],
    });
  });

  it('walks forwards for `after`', () => {
    expect(cursorFilter(cursor, 'after')).toEqual({
      OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, publicId: { gt: 'msg_mid' } }],
    });
  });

  it('includes a tiebreaker branch — without it, messages sharing a millisecond would be skipped or repeated', () => {
    const filter = cursorFilter(cursor, 'before') as { OR: Array<Record<string, unknown>> };
    expect(filter.OR).toHaveLength(2);
    // The second branch pins createdAt exactly and compares the id.
    expect(filter.OR[1].createdAt).toEqual(cursor.createdAt);
  });
});
