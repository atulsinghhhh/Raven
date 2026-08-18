import { createHmac, randomBytes } from 'crypto';
import { customAlphabet } from 'nanoid';

// Unambiguous alphabet (no 0/O/1/l) for identifiers that humans may need
// to read back, e.g. from logs or a dashboard, without confusion.
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const nanoid = customAlphabet(alphabet, 12);

/** Public, non-secret identifier for an API key row — safe to log, index, and display. */
export function generateApiKeyPublicId(): string {
  return `rvk_${nanoid()}`;
}

/** High-entropy secret shown to the developer exactly once. Never stored raw. */
export function generateApiKeySecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Opaque, URL-safe participant/session identifier for RTC tokens. */
export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('base64url')}`;
}

/**
 * Applies an HMAC pepper before bcrypt hashing. Fixes the output at 32
 * bytes regardless of secret/pepper length, so it's safe from bcrypt's
 * 72-byte input truncation — string-concatenating a long pepper directly
 * would risk silently truncating the actual secret's contribution.
 */
export function pepper(secret: string, pepperKey: string): string {
  return createHmac('sha256', pepperKey).update(secret).digest('base64url');
}
