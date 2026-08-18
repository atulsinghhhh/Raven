import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Every error leaving the API passes through here. Known HttpExceptions
 * (our AppError subclasses included) keep their own status/message.
 * Anything else counts as an unexpected bug: gets logged in full on the
 * server, but the client only ever sees a generic 500 — no stack trace,
 * no DB error text, no file paths.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      response.status(status).json(
        typeof body === 'string'
          ? { message: body, path: request.url }
          : { ...(body as Record<string, unknown>), path: request.url },
      );
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      path: request.url,
    });
  }
}
