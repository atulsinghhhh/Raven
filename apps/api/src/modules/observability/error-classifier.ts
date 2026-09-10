import { ErrorCategory } from '../../generated/prisma/client';

export interface ErrorClassificationInput {
  code?: string;
  message?: string;
  iceConnectionState?: string;
  signalingState?: string;
  /** Optional client-supplied hint when the SDK can tell more than the bare code (e.g. 'turn_unreachable'). */
  hint?: string;
}

export interface ErrorClassification {
  category: ErrorCategory;
  /** "Likely cause" language, never stated as certain (Phase 9 spec §20). */
  likelyCause: string;
  suggestedAction: string;
}

/**
 * Maps an `@ravenkash/rtc` `RTCError` (plus a little connection context) onto
 * a Livqeno-facing error category and a plain-language explanation: never
 * a raw SFU or coturn error code. This is the one place that mapping
 * lives; both the ingest pipeline and any future re-classification pass
 * should go through it. See docs/error-codes.md.
 */
export function classifyError(input: ErrorClassificationInput): ErrorClassification {
  switch (input.code) {
    case 'INVALID_TOKEN':
      return {
        category: ErrorCategory.TOKEN_ERROR,
        likelyCause: 'The RTC token was malformed or not recognized.',
        suggestedAction: 'Mint a fresh RTC token from your backend and retry.',
      };
    case 'TOKEN_EXPIRED':
      return {
        category: ErrorCategory.TOKEN_ERROR,
        likelyCause: 'The RTC token had already expired before (or during) the connection attempt.',
        suggestedAction: 'Mint a fresh RTC token — tokens are always short-lived by design.',
      };
    case 'PERMISSION_DENIED':
      return {
        category: ErrorCategory.AUTHORIZATION_ERROR,
        likelyCause: "The token doesn't grant the permission this action required (e.g. publish/subscribe).",
        suggestedAction: 'Check the permissions requested when the RTC token was minted.',
      };
    case 'ROOM_NOT_FOUND':
      return {
        category: ErrorCategory.CLIENT_ERROR,
        likelyCause: 'The client tried to join a room that does not match this token.',
        suggestedAction: 'Confirm the roomId passed to join() matches the token exactly.',
      };
    case 'CAMERA_PERMISSION_DENIED':
    case 'MICROPHONE_PERMISSION_DENIED':
    case 'DEVICE_NOT_FOUND':
    case 'MEDIA_ERROR':
      return {
        category: ErrorCategory.CLIENT_ERROR,
        likelyCause: 'A local browser/device permission or hardware issue prevented camera or microphone access.',
        suggestedAction: 'Check the browser permission prompt and available devices on the client.',
      };
    case 'TIMEOUT':
      return {
        category: ErrorCategory.NETWORK_ERROR,
        likelyCause: 'The connection attempt did not complete in time.',
        suggestedAction: "Check the client's network connection and retry.",
      };
    case 'NETWORK_ERROR':
      return {
        category: ErrorCategory.NETWORK_ERROR,
        likelyCause: 'A network-level failure interrupted the connection.',
        suggestedAction: "Check the client's internet connectivity and retry.",
      };
    case 'SIGNALING_ERROR':
      return {
        category: ErrorCategory.SIGNALING_ERROR,
        likelyCause: 'The signaling channel to the RTC endpoint could not be established or was interrupted.',
        suggestedAction: 'Check that the RTC endpoint URL is reachable from the client network.',
      };
    case 'CONNECTION_FAILED':
      return classifyConnectionFailure(input);
    default:
      return {
        category: ErrorCategory.UNKNOWN_ERROR,
        likelyCause: "Cause unclear from the information reported.",
        suggestedAction: 'Check the connection timeline and reproduce with SDK debug logging enabled.',
      };
  }
}

function classifyConnectionFailure(input: ErrorClassificationInput): ErrorClassification {
  if (input.hint === 'turn_unreachable') {
    return {
      category: ErrorCategory.TURN_ERROR,
      likelyCause: 'Unable to establish a TURN relay connection — possibly a restrictive firewall/NAT blocking UDP.',
      suggestedAction: 'Check whether UDP traffic is blocked; try a TCP/TLS TURN transport instead.',
    };
  }
  if (input.iceConnectionState === 'failed' || input.iceConnectionState === 'disconnected') {
    return {
      category: ErrorCategory.ICE_ERROR,
      likelyCause: 'ICE connectivity checks failed between the client and the media server — likely a firewall/NAT restriction.',
      suggestedAction: 'Ensure TURN is reachable from this network; corporate proxies/firewalls are the most common cause.',
    };
  }
  if (input.signalingState && input.signalingState !== 'stable' && input.signalingState !== 'connected') {
    return {
      category: ErrorCategory.SIGNALING_ERROR,
      likelyCause: 'The signaling handshake did not complete.',
      suggestedAction: 'Check connectivity to the RTC endpoint and retry.',
    };
  }
  return {
    category: ErrorCategory.SFU_ERROR,
    likelyCause: 'The media server could not complete this connection.',
    suggestedAction: 'Retry, and check `raven status`/`raven diagnostics` for SFU health.',
  };
}
