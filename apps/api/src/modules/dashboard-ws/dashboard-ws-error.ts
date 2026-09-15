import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { DashboardWsErrorCode, DashboardWsServerFrame } from './dashboard-ws.constants';

/**
 * One error type for the dashboard realtime plane, thrown by
 * DashboardWsTokenService and translated at the gateway into an `error`
 * frame plus a specific close code. Mirrors ChatError/`chat-error.ts`:
 * same reason, a service shouldn't need to know which transport is calling
 * it, and the HTTP body (token mint failures surface as plain
 * NotFoundError/ForbiddenError from ProjectsService.authorize, not this
 * class) never needs to see the WebSocket-specific code.
 */
export class DashboardWsError extends AppError {
  readonly wsCode: DashboardWsErrorCode;

  constructor(code: DashboardWsErrorCode, message: string) {
    super(message, statusFor(code), ravenCodeFor(code), { legacyCode: code });
    this.wsCode = code;
  }

  toFrame() {
    return { type: DashboardWsServerFrame.ERROR, code: this.wsCode, message: this.message };
  }
}

function ravenCodeFor(code: DashboardWsErrorCode): RavenErrorCode {
  switch (code) {
    case DashboardWsErrorCode.TOKEN_EXPIRED:
      return RavenErrorCode.TOKEN_EXPIRED;
    case DashboardWsErrorCode.INVALID_TOKEN:
    case DashboardWsErrorCode.TOKEN_REVOKED:
      return RavenErrorCode.AUTH_ERROR;
    case DashboardWsErrorCode.ORIGIN_NOT_ALLOWED:
      return RavenErrorCode.PERMISSION_DENIED;
    case DashboardWsErrorCode.RATE_LIMITED:
      return RavenErrorCode.RATE_LIMITED;
    default:
      return RavenErrorCode.VALIDATION_FAILED;
  }
}

function statusFor(code: DashboardWsErrorCode): HttpStatus {
  switch (code) {
    case DashboardWsErrorCode.INVALID_TOKEN:
    case DashboardWsErrorCode.TOKEN_EXPIRED:
    case DashboardWsErrorCode.TOKEN_REVOKED:
      return HttpStatus.UNAUTHORIZED;
    case DashboardWsErrorCode.ORIGIN_NOT_ALLOWED:
      return HttpStatus.FORBIDDEN;
    case DashboardWsErrorCode.RATE_LIMITED:
      return HttpStatus.TOO_MANY_REQUESTS;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}
