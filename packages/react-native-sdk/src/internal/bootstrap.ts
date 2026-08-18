import { registerGlobals } from '@livekit/react-native';

let registered = false;

/**
 * Installs the WebRTC globals React Native doesn't ship with.
 *
 * This is the single reason `@raven/rtc` — a package written for browsers —
 * runs unmodified on a phone. `registerGlobals()` puts
 * `RTCPeerConnection`, `navigator.mediaDevices`, `MediaStream` and friends
 * on the global object, backed by the native iOS/Android WebRTC
 * implementation in `@livekit/react-native-webrtc`. From that point on,
 * the code in `@raven/rtc` cannot tell it isn't in a browser.
 *
 * That's the whole architecture of this package: Raven's RTC and chat
 * logic is shared with web, and only the parts that genuinely differ —
 * rendering, permissions, app lifecycle, audio routing — live here.
 *
 * Must run before any Raven client is constructed, and exactly once. It's
 * called automatically by `new Raven(...)`, so a developer never has to
 * remember it; calling it yourself earlier (in `index.js`, before the
 * first render) is supported and occasionally useful.
 */
export function bootstrapRavenNative(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerGlobals();
  installBase64Polyfill();
}

/** @internal test-only — lets a suite assert the once-only behaviour. */
export function __resetBootstrapForTests(): void {
  registered = false;
}

/**
 * `@raven/chat` decodes its token payload with `atob` to learn the user
 * id and expiry without a round-trip. Hermes has shipped `atob`/`btoa`
 * since React Native 0.74; older runtimes and some JSC configurations
 * haven't. Rather than declare a floor we don't otherwise need, fill the
 * gap when it exists.
 *
 * Deliberately minimal: this decodes standard base64 only, which is all
 * the JWT path asks of it. It is not a general-purpose polyfill and
 * doesn't pretend to be.
 */
function installBase64Polyfill(): void {
  const globalRef = globalThis as typeof globalThis & {
    atob?: (input: string) => string;
    btoa?: (input: string) => string;
  };

  if (typeof globalRef.atob !== 'function') {
    globalRef.atob = (input: string): string => {
      const normalized = input.replace(/[=]+$/, '');
      let output = '';
      let buffer = 0;
      let bits = 0;

      for (const char of normalized) {
        const value = BASE64_ALPHABET.indexOf(char);
        if (value === -1) {
          throw new Error('atob: input is not valid base64');
        }
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          output += String.fromCharCode((buffer >> bits) & 0xff);
        }
      }

      return output;
    };
  }

  if (typeof globalRef.btoa !== 'function') {
    globalRef.btoa = (input: string): string => {
      let output = '';
      for (let i = 0; i < input.length; i += 3) {
        const chunk = [input.charCodeAt(i), input.charCodeAt(i + 1), input.charCodeAt(i + 2)];
        const triplet = (chunk[0] << 16) | ((chunk[1] || 0) << 8) | (chunk[2] || 0);

        output += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
        output += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
        output += Number.isNaN(chunk[1]) ? '=' : BASE64_ALPHABET[(triplet >> 6) & 0x3f];
        output += Number.isNaN(chunk[2]) ? '=' : BASE64_ALPHABET[triplet & 0x3f];
      }
      return output;
    };
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
