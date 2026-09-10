import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
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
      // carry a Livqeno code, so one is derived from the status. Without
      // this a caller would see a coded body from our services and an
      // uncoded one from the framework, for the same class of problem.
      const framework = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
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

    // Pool exhaustion is the one "unexpected" failure that is really a
    // capacity answer, and it must never leave here as a 500. See
    // isPoolExhaustion below.
    if (isPoolExhaustion(exception)) {
      // Full detail server-side — which route, which request — because
      // this is the line an operator uses to decide whether to raise
      // DATABASE_POOL_MAX or add an instance. Never the connection string:
      // the message is matched, not echoed.
      this.logger.error(
        `database connection pool exhausted on ${request.method} ${request.url} ` +
          `[${requestId ?? 'no-request-id'}] — returning 503 ${RavenErrorCode.CAPACITY_EXCEEDED}`,
      );
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        message:
          'The service is at database capacity right now — retry shortly. ' +
          'This is a server-side limit, not a problem with your request.',
        code: RavenErrorCode.CAPACITY_EXCEEDED,
        legacyCode: LEGACY_ERROR_CODE[RavenErrorCode.CAPACITY_EXCEEDED],
        retryAfterSeconds: 1,
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

/**
 * Whether this exception is `pg` giving up on acquiring a pool connection.
 *
 * `AdmissionControlService` is what should normally stop a burst reaching
 * this point, and it bounds the paths it is applied to. This is the
 * backstop for every other path — a slow query holding connections, a
 * background sweep, an endpoint nobody thought to bound — and it exists
 * because the alternative is what shipped before: pool exhaustion arriving
 * as `500 RAVEN_INTERNAL_ERROR`, a response that tells a developer their
 * integration is broken and that no client retries.
 *
 * ## Why this matches on a message
 *
 * Because there is nothing better to match on. `pg`'s pool rejects with a
 * plain `Error` carrying no code (`Error: timeout exceeded when trying to
 * connect`), and Prisma's driver adapter passes it through unwrapped. So
 * the string is the contract. It is narrow — the phrase is `pg`'s own, and
 * appears nowhere else — and the failure mode of a miss is simply the
 * previous behaviour, a 500, rather than a wrong answer.
 *
 * Deliberately *not* matched: statement timeouts, `ECONNREFUSED`, and
 * anything else meaning the database is unreachable rather than busy.
 * Those are genuine faults, not capacity, and a client should not be told
 * to retry in a second.
 */
function isPoolExhaustion(exception: unknown): boolean {
  const message = exception instanceof Error ? exception.message : '';
  if (!message) {
    return false;
  }
  return (
    message.includes('timeout exceeded when trying to connect') ||
    // pg-pool's other refusal: the pool was ended, or its queue was capped
    // by `maxWaitingClients`, which a deployment may well set.
    message.includes('Cannot use a pool after calling end') ||
    message.includes('too many clients already')
  );
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
