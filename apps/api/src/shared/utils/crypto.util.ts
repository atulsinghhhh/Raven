import { createHmac, randomBytes } from 'crypto';
import { customAlphabet } from 'nanoid';
import { ENVIRONMENT_KEY_SEGMENT, Environment } from '../environment/environment.constants';

// No 0/O/1/l in this alphabet: these ids get read back by humans from
// logs or a dashboard often enough that ambiguous chars are annoying.
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const nanoid = customAlphabet(alphabet, 12);

/**
 * Public, non-secret identifier for an API key row: safe to log, index, and
 * display.
 *
 * The environment segment (`rvk_prod_...`) is there so a developer can tell
 * at a glance which environment a key belongs to. It is decoration for
 * humans, not a claim: authentication reads the environment from the key's
 * row, so editing the prefix changes nothing. Keys minted before this
 * existed have no segment and keep working.
 */
export function generateApiKeyPublicId(environment?: Environment): string {
  const segment = environment ? `${ENVIRONMENT_KEY_SEGMENT[environment]}_` : '';
  return `rvk_${segment}${nanoid()}`;
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
 * HMAC pepper applied before bcrypt hashing. Output is a fixed 32 bytes
 * no matter how long the secret/pepper are, which keeps us clear of
 * bcrypt's 72-byte truncation: just concatenating a long pepper onto the
 * secret could silently chop off part of the actual secret.
 */
export function pepper(secret: string, pepperKey: string): string {
  return createHmac('sha256', pepperKey).update(secret).digest('base64url');
}
