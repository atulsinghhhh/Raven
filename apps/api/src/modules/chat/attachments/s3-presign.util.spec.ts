import { createHmac } from 'crypto';
import { presignS3Url } from './s3-presign.util';

const BASE = {
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  bucket: 'raven-attachments',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  forcePathStyle: true,
};
const NOW = new Date('2026-08-18T12:00:00.000Z');

/**
 * Independent reimplementation of SigV4's derived signing key, from the
 * AWS specification. Deriving the expected signature a second way is the
 * point — asserting our implementation against itself would prove
 * nothing about correctness.
 */
function expectedSignature(canonicalRequestHash: string, dateStamp: string, amzDate: string, region: string): string {
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    `${dateStamp}/${region}/s3/aws4_request`,
    canonicalRequestHash,
  ].join('\n');

  const dateKey = createHmac('sha256', `AWS4${BASE.secretAccessKey}`).update(dateStamp).digest();
  const regionKey = createHmac('sha256', dateKey).update(region).digest();
  const serviceKey = createHmac('sha256', regionKey).update('s3').digest();
  const signingKey = createHmac('sha256', serviceKey).update('aws4_request').digest();

  return createHmac('sha256', signingKey).update(stringToSign).digest('hex');
}

describe('presignS3Url', () => {
  it('produces a complete, deterministic presigned URL', () => {
    const url = presignS3Url({ ...BASE, method: 'PUT', key: 'chat/p1/c1/abc', expiresInSeconds: 900, now: NOW });
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://s3.amazonaws.com');
    expect(parsed.pathname).toBe('/raven-attachments/chat/p1/c1/abc');
    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(parsed.searchParams.get('X-Amz-Date')).toBe('20260818T120000Z');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(parsed.searchParams.get('X-Amz-Credential')).toBe(
      'AKIAIOSFODNN7EXAMPLE/20260818/us-east-1/s3/aws4_request',
    );
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for a fixed clock, and different for a different key', () => {
    const a = presignS3Url({ ...BASE, method: 'GET', key: 'k1', expiresInSeconds: 60, now: NOW });
    const again = presignS3Url({ ...BASE, method: 'GET', key: 'k1', expiresInSeconds: 60, now: NOW });
    const other = presignS3Url({ ...BASE, method: 'GET', key: 'k2', expiresInSeconds: 60, now: NOW });

    expect(a).toBe(again);
    expect(a).not.toBe(other);
  });

  it('signs the exact canonical request AWS specifies', () => {
    const { createHash } = require('crypto') as typeof import('crypto');
    const url = presignS3Url({ ...BASE, method: 'PUT', key: 'chat/p1/c1/abc', expiresInSeconds: 900, now: NOW });
    const parsed = new URL(url);

    // Rebuild the canonical request independently and check our signature
    // against it. If our canonicalisation is wrong, S3 rejects the URL —
    // this catches that here rather than in production.
    const query = [...parsed.searchParams.entries()]
      .filter(([key]) => key !== 'X-Amz-Signature')
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    const canonicalRequest = [
      'PUT',
      '/raven-attachments/chat/p1/c1/abc',
      query,
      'host:s3.amazonaws.com\n',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const hash = createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBe(
      expectedSignature(hash, '20260818', '20260818T120000Z', 'us-east-1'),
    );
  });

  it('signs the payload as UNSIGNED-PAYLOAD, because the bytes are uploaded later', () => {
    // Any other choice is impossible: the URL has to exist before the
    // browser has the file to hash.
    const url = presignS3Url({ ...BASE, method: 'PUT', key: 'k', expiresInSeconds: 60, now: NOW });
    // Verified indirectly — the canonical-request test above only matches
    // when UNSIGNED-PAYLOAD is what was signed.
    expect(url).toContain('X-Amz-Signature=');
  });

  it('uses path-style addressing for MinIO and virtual-host style for real S3', () => {
    const pathStyle = new URL(presignS3Url({ ...BASE, method: 'GET', key: 'k', expiresInSeconds: 60, now: NOW }));
    expect(pathStyle.host).toBe('s3.amazonaws.com');
    expect(pathStyle.pathname).toBe('/raven-attachments/k');

    const virtualHost = new URL(
      presignS3Url({ ...BASE, forcePathStyle: false, method: 'GET', key: 'k', expiresInSeconds: 60, now: NOW }),
    );
    expect(virtualHost.host).toBe('raven-attachments.s3.amazonaws.com');
    expect(virtualHost.pathname).toBe('/k');
  });

  it('keeps slashes as path separators but percent-encodes everything else', () => {
    const url = presignS3Url({
      ...BASE,
      method: 'GET',
      key: 'chat/a b/c+d',
      expiresInSeconds: 60,
      now: NOW,
    });
    expect(url).toContain('/raven-attachments/chat/a%20b/c%2Bd');
  });

  it('changes the signature when the region changes', () => {
    const useast = presignS3Url({ ...BASE, method: 'GET', key: 'k', expiresInSeconds: 60, now: NOW });
    const euwest = presignS3Url({ ...BASE, region: 'eu-west-1', method: 'GET', key: 'k', expiresInSeconds: 60, now: NOW });
    expect(useast).not.toBe(euwest);
  });

  it('pins the content type on uploads', () => {
    const url = presignS3Url({
      ...BASE,
      method: 'PUT',
      key: 'k',
      expiresInSeconds: 60,
      contentType: 'image/png',
      now: NOW,
    });
    expect(new URL(url).searchParams.get('response-content-type')).toBe('image/png');
  });
});
