import { signWebhookPayload, verifyWebhookSignature } from './webhook-signature.util';

const SECRET = 'whsec_test_secret';
const BODY = JSON.stringify({ id: 'evt_1', type: 'message.created', data: { message: { id: 'msg_1' } } });
const NOW = 1_787_000_000;

describe('signWebhookPayload', () => {
  it('produces the documented t=…,v1=… format', () => {
    expect(signWebhookPayload(BODY, SECRET, NOW)).toMatch(/^t=1787000000,v1=[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(signWebhookPayload(BODY, SECRET, NOW)).toBe(signWebhookPayload(BODY, SECRET, NOW));
  });

  it('changes when the body changes', () => {
    expect(signWebhookPayload(BODY, SECRET, NOW)).not.toBe(signWebhookPayload(`${BODY} `, SECRET, NOW));
  });

  it('changes when the timestamp changes — the timestamp is inside the signed payload', () => {
    // This is what makes replay protection work: an attacker can't take a
    // captured delivery, bolt a fresh timestamp on, and have it verify.
    expect(signWebhookPayload(BODY, SECRET, NOW)).not.toBe(signWebhookPayload(BODY, SECRET, NOW + 1));
  });

  it('changes when the secret changes', () => {
    expect(signWebhookPayload(BODY, SECRET, NOW)).not.toBe(signWebhookPayload(BODY, 'whsec_other', NOW));
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a signature it just produced', () => {
    const header = signWebhookPayload(BODY, SECRET, NOW);
    expect(verifyWebhookSignature(BODY, header, SECRET, NOW)).toBe(true);
  });

  it('rejects a body that was modified in transit', () => {
    const header = signWebhookPayload(BODY, SECRET, NOW);
    const tampered = BODY.replace('msg_1', 'msg_evil');
    expect(verifyWebhookSignature(tampered, header, SECRET, NOW)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const header = signWebhookPayload(BODY, SECRET, NOW);
    expect(verifyWebhookSignature(BODY, header, 'whsec_wrong', NOW)).toBe(false);
  });

  it('rejects a replay outside the tolerance window', () => {
    const header = signWebhookPayload(BODY, SECRET, NOW);
    // Ten minutes later, default tolerance is five.
    expect(verifyWebhookSignature(BODY, header, SECRET, NOW + 600)).toBe(false);
    // Still fine four minutes later.
    expect(verifyWebhookSignature(BODY, header, SECRET, NOW + 240)).toBe(true);
  });

  it('rejects a timestamp from the future beyond tolerance, not just the past', () => {
    const header = signWebhookPayload(BODY, SECRET, NOW);
    expect(verifyWebhookSignature(BODY, header, SECRET, NOW - 600)).toBe(false);
  });

  it('honours a caller-supplied tolerance', () => {
    const header = signWebhookPayload(BODY, SECRET, NOW);
    expect(verifyWebhookSignature(BODY, header, SECRET, NOW + 600, 900)).toBe(true);
  });

  it.each([
    ['', 'empty header'],
    ['garbage', 'no key=value pairs'],
    ['t=abc,v1=deadbeef', 'non-numeric timestamp'],
    [`t=${NOW}`, 'missing signature'],
    [`v1=${'0'.repeat(64)}`, 'missing timestamp'],
  ])('rejects a malformed header (%s)', (header) => {
    expect(verifyWebhookSignature(BODY, header, SECRET, NOW)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on mismatched buffer lengths, so the length
    // check has to come first: otherwise a short signature crashes the
    // receiver instead of being rejected.
    expect(() => verifyWebhookSignature(BODY, `t=${NOW},v1=short`, SECRET, NOW)).not.toThrow();
    expect(verifyWebhookSignature(BODY, `t=${NOW},v1=short`, SECRET, NOW)).toBe(false);
  });

  it('tolerates whitespace around the parts', () => {
    const header = signWebhookPayload(BODY, SECRET, NOW);
    const spaced = header.split(',').join(', ');
    expect(verifyWebhookSignature(BODY, spaced, SECRET, NOW)).toBe(true);
  });
});
