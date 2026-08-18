import { REQUEST_ID_PREFIX, generateRequestId, resolveRequestId } from './request-id.util';

describe('request id', () => {
  describe('generateRequestId', () => {
    it('is prefixed so a developer can recognise one on sight', () => {
      expect(generateRequestId().startsWith(REQUEST_ID_PREFIX)).toBe(true);
    });

    it('does not repeat', () => {
      const ids = new Set(Array.from({ length: 500 }, () => generateRequestId()));
      expect(ids.size).toBe(500);
    });
  });

  describe('resolveRequestId', () => {
    it('reuses a well-formed inbound id so one call can be traced across both sides', () => {
      expect(resolveRequestId('req_abc123')).toBe('req_abc123');
    });

    it('accepts an id from another system that does not use our prefix', () => {
      // Correlation is the point; insisting on our own format would defeat it.
      expect(resolveRequestId('0HN7GK4L9J2P1')).toBe('0HN7GK4L9J2P1');
    });

    it('generates one when the header is absent', () => {
      expect(resolveRequestId(undefined).startsWith(REQUEST_ID_PREFIX)).toBe(true);
    });

    // The value lands in log lines and error bodies, so anything that could
    // forge a log entry or smuggle terminal escapes has to be refused.
    it.each([
      ['a newline (forges a second log line)', 'req_ok\nlevel=fatal breached=true'],
      ['a carriage return', 'req_ok\r\nfake'],
      ['an ANSI escape', 'req_\u001b[31mred'],
      ['a null byte', 'req_\u0000'],
      ['a space', 'req_a b'],
      ['JSON punctuation', 'req_","admin":true'],
      ['an empty string', ''],
      ['65 characters (one over the cap)', 'a'.repeat(65)],
    ])('discards %s and generates a fresh id instead', (_label, hostile) => {
      const resolved = resolveRequestId(hostile);
      expect(resolved).not.toBe(hostile);
      expect(resolved.startsWith(REQUEST_ID_PREFIX)).toBe(true);
    });

    it('accepts exactly 64 characters', () => {
      const boundary = 'a'.repeat(64);
      expect(resolveRequestId(boundary)).toBe(boundary);
    });

    it('takes the first value when a header is repeated', () => {
      // Express hands over an array for duplicated headers; picking one is
      // required, and the first is the one a proxy chain set earliest.
      expect(resolveRequestId(['req_first', 'req_second'])).toBe('req_first');
    });

    it('rejects a non-string, such as a parsed JSON object', () => {
      expect(resolveRequestId({ toString: () => 'req_sneaky' }).startsWith(REQUEST_ID_PREFIX)).toBe(
        true,
      );
    });
  });
});
