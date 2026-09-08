import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LEGACY_ERROR_CODE, RavenErrorCode } from './error-codes';

/**
 * Every error leaving the API passes through here. Known HttpExceptions
 * (our AppError subclasses included) keep their own status/message.
 * Anything else counts as an unexpected bug: gets logged in full on the
 * server, but the client only ever sees a generic 500: no stack trace,
 * no DB error text, no file paths.
 *
 * Every body carries `requestId`. It is the single thing that turns "it
 * returned a 500" into a report someone can act on, so it is attached
 * here rather than left to each handler to remember.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.requestId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Nest's own exceptions (ValidationPipe, 404 handler, guards) do not
      // carry a Raven code, so one is derived from the status. Without
      // this a caller would see a coded body from our services and an
      // uncoded one from the framework, for the same class of problem.
      const framework =
        typeof body === 'string'
          ? { message: body }
          : (body as Record<string, unknown>);
      const code = (framework.code as string | undefined) ?? codeForStatus(status);

      response.status(status).json({
        ...framework,
        code,
        legacyCode: framework.legacyCode ?? LEGACY_ERROR_CODE[code as RavenErrorCode] ?? code,
        ...(requestId ? { requestId } : {}),
        path: request.url,
      });
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url} [${requestId ?? 'no-request-id'}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Internal server error',
      code: RavenErrorCode.INTERNAL_ERROR,
      legacyCode: LEGACY_ERROR_CODE[RavenErrorCode.INTERNAL_ERROR],
      ...(requestId ? { requestId } : {}),
      path: request.url,
    });
  }
}

function codeForStatus(status: number): RavenErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return RavenErrorCode.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return RavenErrorCode.AUTH_ERROR;
    case HttpStatus.FORBIDDEN:
      return RavenErrorCode.PERMISSION_DENIED;
    case HttpStatus.NOT_FOUND:
      return RavenErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return RavenErrorCode.CONFLICT;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return RavenErrorCode.PAYLOAD_TOO_LARGE;
    case HttpStatus.TOO_MANY_REQUESTS:
      return RavenErrorCode.RATE_LIMITED;
    default:
      return status >= 500 ? RavenErrorCode.INTERNAL_ERROR : RavenErrorCode.VALIDATION_FAILED;
  }
}
