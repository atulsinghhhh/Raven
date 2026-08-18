/**
 * Phase 11 addition — feature-detects what this SDK actually needs,
 * rather than a user-agent allowlist (which goes stale). See
 * docs/sdk/web.md#browser-support for the documented support matrix.
 */
export interface BrowserSupportDetails {
  supported: boolean;
  missing: string[];
}

export function getBrowserSupportDetails(): BrowserSupportDetails {
  const missing: string[] = [];

  if (typeof RTCPeerConnection === 'undefined') missing.push('RTCPeerConnection');
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) missing.push('navigator.mediaDevices.getUserMedia');
  if (typeof WebSocket === 'undefined') missing.push('WebSocket');

  return { supported: missing.length === 0, missing };
}

/** Convenience over `getBrowserSupportDetails()` for a simple yes/no check. */
export function isBrowserSupported(): boolean {
  return getBrowserSupportDetails().supported;
}
