/**
 * The canonical Raven error vocabulary.
 *
 * One namespace for every error the HTTP API can return, so a developer
 * can switch on `error.code` without caring which subsystem produced it.
 * The `RAVEN_` prefix exists so these never collide with an application's
 * own error codes once they have travelled through an SDK.
 *
 * Two wire contracts by design do *not* use these codes:
 *
 * - The chat WebSocket `error` frame keeps its `ChatErrorCode` vocabulary
 *   (docs/chat/websocket.md). A frame is a different contract from an HTTP
 *   body, `@corvidhq/chat` maps it today, and renaming it would break every
 *   connected client for no benefit. `ChatError` therefore carries both:
 *   the chat code on the frame, the canonical code on the HTTP body.
 * - The signaling WebSocket keeps its own codes for the same reason.
 */
export const RavenErrorCode = {
  // --- Authentication and authorization -----------------------------------
  /** Credentials missing, malformed, or rejected. */
  AUTH_ERROR: 'RAVEN_AUTH_ERROR',
  /** Authenticated, but not allowed to do this. */
  PERMISSION_DENIED: 'RAVEN_PERMISSION_DENIED',
  /** Distinct from AUTH_ERROR on purpose: the client should refresh, not re-login. */
  TOKEN_EXPIRED: 'RAVEN_TOKEN_EXPIRED',

  // --- Not found ----------------------------------------------------------
  /** Generic fallback when no resource-specific code applies. */
  NOT_FOUND: 'RAVEN_NOT_FOUND',
  ROOM_NOT_FOUND: 'RAVEN_ROOM_NOT_FOUND',
  CONVERSATION_NOT_FOUND: 'RAVEN_CONVERSATION_NOT_FOUND',
  MESSAGE_NOT_FOUND: 'RAVEN_MESSAGE_NOT_FOUND',
  PROJECT_NOT_FOUND: 'RAVEN_PROJECT_NOT_FOUND',
  ATTACHMENT_NOT_FOUND: 'RAVEN_ATTACHMENT_NOT_FOUND',
  STREAM_NOT_FOUND: 'RAVEN_STREAM_NOT_FOUND',
  RTC_SERVER_NOT_FOUND: 'RAVEN_RTC_SERVER_NOT_FOUND',

  // --- Conflict -----------------------------------------------------------
  CONFLICT: 'RAVEN_CONFLICT',
  MESSAGE_ALREADY_EXISTS: 'RAVEN_MESSAGE_ALREADY_EXISTS',
  CONVERSATION_ARCHIVED: 'RAVEN_CONVERSATION_ARCHIVED',
  /** A lifecycle operation that isn't valid from the stream's current status: e.g. starting an already-LIVE stream, or anything on an ENDED one. */
  STREAM_INVALID_STATE: 'RAVEN_STREAM_INVALID_STATE',

  // --- Request problems ---------------------------------------------------
  VALIDATION_FAILED: 'RAVEN_VALIDATION_FAILED',
  RATE_LIMITED: 'RAVEN_RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'RAVEN_PAYLOAD_TOO_LARGE',
  /** Separate from PAYLOAD_TOO_LARGE: the two limits are configured
   *  independently, so a developer needs to know which one they hit. */
  MESSAGE_TOO_LARGE: 'RAVEN_MESSAGE_TOO_LARGE',
  ATTACHMENT_TOO_LARGE: 'RAVEN_ATTACHMENT_TOO_LARGE',
  /** "Your pagination is broken" is a different fix from "your body is
   *  malformed", so this does not collapse into VALIDATION_FAILED. */
  INVALID_CURSOR: 'RAVEN_INVALID_CURSOR',

  // --- Infrastructure -----------------------------------------------------
  CONNECTION_FAILED: 'RAVEN_CONNECTION_FAILED',
  /** No healthy RTC server had room for this call. An operator/capacity
   *  problem, not a caller one: distinct from CONNECTION_FAILED so that a
   *  developer seeing it knows to look at the fleet, not at their code. */
  NO_RTC_CAPACITY: 'RAVEN_NO_RTC_CAPACITY',
  WEBHOOK_FAILED: 'RAVEN_WEBHOOK_FAILED',
  /** A feature the deployment has not enabled: an operator fix, not a
   *  caller one, and returned with 501, not 4xx. */
  NOT_CONFIGURED: 'RAVEN_NOT_CONFIGURED',
  /** The only code an unexpected exception is ever allowed to surface as. */
  INTERNAL_ERROR: 'RAVEN_INTERNAL_ERROR',
} as const;

export type RavenErrorCode = (typeof RavenErrorCode)[keyof typeof RavenErrorCode];

/**
 * What each canonical code used to be called on the wire.
 *
 * Emitted alongside `code` as `legacyCode` for one deprecation window, so
 * anything already switching on the old value keeps working while it
 * migrates. Nothing in this repository reads it: it exists purely for
 * callers we cannot see. See docs/error-codes.md for the removal plan.
 */
export const LEGACY_ERROR_CODE: Record<RavenErrorCode, string> = {
  [RavenErrorCode.AUTH_ERROR]: 'UNAUTHORIZED',
  [RavenErrorCode.PERMISSION_DENIED]: 'FORBIDDEN',
  [RavenErrorCode.TOKEN_EXPIRED]: 'UNAUTHORIZED',
  [RavenErrorCode.NOT_FOUND]: 'NOT_FOUND',
  [RavenErrorCode.ROOM_NOT_FOUND]: 'NOT_FOUND',
  [RavenErrorCode.CONVERSATION_NOT_FOUND]: 'NOT_FOUND',
  [RavenErrorCode.MESSAGE_NOT_FOUND]: 'NOT_FOUND',
  [RavenErrorCode.PROJECT_NOT_FOUND]: 'NOT_FOUND',
  [RavenErrorCode.ATTACHMENT_NOT_FOUND]: 'ATTACHMENT_NOT_FOUND',
  [RavenErrorCode.STREAM_NOT_FOUND]: 'NOT_FOUND',
  [RavenErrorCode.RTC_SERVER_NOT_FOUND]: 'NOT_FOUND',
  [RavenErrorCode.CONFLICT]: 'CONFLICT',
  [RavenErrorCode.MESSAGE_ALREADY_EXISTS]: 'CONFLICT',
  [RavenErrorCode.CONVERSATION_ARCHIVED]: 'CONVERSATION_ARCHIVED',
  [RavenErrorCode.STREAM_INVALID_STATE]: 'CONFLICT',
  [RavenErrorCode.VALIDATION_FAILED]: 'VALIDATION_FAILED',
  [RavenErrorCode.RATE_LIMITED]: 'RATE_LIMITED',
  [RavenErrorCode.PAYLOAD_TOO_LARGE]: 'VALIDATION_FAILED',
  [RavenErrorCode.MESSAGE_TOO_LARGE]: 'MESSAGE_TOO_LARGE',
  [RavenErrorCode.ATTACHMENT_TOO_LARGE]: 'ATTACHMENT_TOO_LARGE',
  [RavenErrorCode.INVALID_CURSOR]: 'INVALID_CURSOR',
  [RavenErrorCode.CONNECTION_FAILED]: 'CONNECTION_FAILED',
  [RavenErrorCode.NO_RTC_CAPACITY]: 'CONNECTION_FAILED',
  [RavenErrorCode.WEBHOOK_FAILED]: 'WEBHOOK_FAILED',
  [RavenErrorCode.NOT_CONFIGURED]: 'ATTACHMENTS_NOT_CONFIGURED',
  [RavenErrorCode.INTERNAL_ERROR]: 'INTERNAL_ERROR',
};
