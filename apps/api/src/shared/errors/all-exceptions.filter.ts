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
 * Every error leaving the API goes through here. Known HttpExceptions
 * (including our AppError subclasses) return their own status/message.
 * Anything else is an unexpected bug — it is logged in full server-side
 * but returned to the client as a generic 500 with no internal detail
 * (no stack trace, no DB driver message, no file paths).
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
