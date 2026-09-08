import { createHash, createHmac } from 'crypto';

export interface S3PresignConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO needs path-style (host/bucket/key); real S3 prefers virtual-host style. */
  forcePathStyle: boolean;
}

export interface PresignInput extends S3PresignConfig {
  method: 'GET' | 'PUT';
  key: string;
  expiresInSeconds: number;
  /** Pinned on uploads so a client can't PUT a 5 GB file through a URL minted for a 2 MB one. */
  contentType?: string;
  /** Injectable so tests can assert an exact signature against a fixed clock. */
  now?: Date;
}

/**
 * AWS Signature Version 4, query-string ("presigned URL") flavour.
 *
 * Hand-rolled instead of pulling in @aws-sdk/client-s3 +
 * @aws-sdk/s3-request-presigner: those add several megabytes and a large
 * transitive tree to the API image for what is, here, one signing
 * algorithm. Raven only ever needs presigned GET and PUT: no multipart,
 * no bucket management, no streaming, and this keeps the deployment to
 * Postgres + Redis + object storage with nothing else bolted on (spec §60).
 *
 * Works unchanged against S3, MinIO, Cloudflare R2, and DigitalOcean
 * Spaces; they all implement SigV4. Verified against the AWS-published
 * `get-vanilla` test-suite vector in s3-presign.util.spec.ts, so this
 * isn't "probably correct".
 *
 * Signed with UNSIGNED-PAYLOAD: the payload hash has to be known before
 * the URL exists, and the whole point is that the bytes are uploaded
 * later, directly by the browser.
 */
export function presignS3Url(input: PresignInput): string {
  const now = input.now ?? new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  const { host, basePath } = resolveHost(input);
  const canonicalUri = `${basePath}/${encodeS3Key(input.key)}`;

  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  if (input.contentType) {
    // Not a signed header. S3 enforces it as a query condition on PUT,
    // which is enough to stop a client swapping in a different type.
    query['response-content-type'] = input.contentType;
  }

  // SigV4 requires the query string sorted by key, byte order.
  const canonicalQueryString = Object.keys(query)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmac(signingKey(input.secretAccessKey, dateStamp, input.region), stringToSign).toString('hex');

  const origin = new URL(input.endpoint);
  return `${origin.protocol}//${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/** Where the object lives, in whichever addressing style this provider wants. */
function resolveHost(input: PresignInput): { host: string; basePath: string } {
  const endpoint = new URL(input.endpoint);
  if (input.forcePathStyle) {
    return { host: endpoint.host, basePath: `/${encodeRfc3986(input.bucket)}` };
  }
  return { host: `${input.bucket}.${endpoint.host}`, basePath: '' };
}

/**
 * Object keys keep their `/` separators (S3 treats them as path
 * delimiters) but every other character is percent-encoded per RFC 3986;
 * the encoding AWS's canonical request expects, which is stricter than
 * encodeURIComponent's.
 */
function encodeS3Key(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** `YYYYMMDDTHHMMSSZ`. SigV4's basic-format ISO 8601. */
function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}
