// jsdom gives us `atob`/`fetch` but not `crypto.randomUUID`, which the SDK
// uses to generate idempotency keys. Polyfill only what's actually needed.
import { webcrypto } from 'crypto';

if (typeof globalThis.crypto === 'undefined') {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}
