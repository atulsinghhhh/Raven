export interface RavenErrorOptions {
  code?: string;
  statusCode?: number;
  requestId?: string;
  details?: unknown;
  cause?: unknown;
}

/**
 * The only error type this SDK throws.
 *
 * Built purely from the parsed response body (`{message, code}`, matching
 * `AppError` on the API side) plus response metadata. Never from anything
 * that could be carrying the API key, so there's no route by which a key
 * ends up in here. And never a server stack trace, a database error, or
 * TURN/RTC credentials (Phase 10 spec §10).
 */
export class RavenError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(message: string, options: RavenErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RavenError';
    this.code = options.code ?? 'RAVEN_UNKNOWN_ERROR';
    this.statusCode = options.statusCode;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export function isRavenError(value: unknown): value is RavenError {
  return value instanceof RavenError;
}
