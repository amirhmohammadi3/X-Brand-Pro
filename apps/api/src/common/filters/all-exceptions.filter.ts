import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { ERROR_HTTP_STATUS, errorMessageKey, type ErrorCode } from '@app/contracts';
import type { Request, Response } from 'express';

interface HttpExceptionBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  code?: ErrorCode;
  details?: unknown;
  /** Explicit i18n key override (e.g. errors.csrf) — wins over the code mapping. */
  messageKey?: string;
}

/**
 * Maps every thrown error to the contracts error envelope:
 * `{ ok: false, error: { code, messageKey, message, details?, requestId } }`.
 *
 * - HttpException: statusCode → code (unless the body carries an explicit code)
 * - validation bodies: details = array of { path, message }
 * - unknown errors: 500 INTERNAL_ERROR; the real message is logged with stack
 *   but never leaked to the client in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Inject('APP_CONFIG') private readonly config: { isProduction: boolean }) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = (req as Request & { id?: string }).id ?? '';

    let status: number;
    let code: ErrorCode;
    let message: string;
    let details: unknown;
    let messageKeyOverride: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = this.codeFromStatus(status);
      const body = exception.getResponse() as HttpExceptionBody | string;
      if (typeof body === 'string') {
        message = body;
      } else {
        // Nest validation pipe (class-validator) and our Zod pipe both put an
        // array of messages on `message`; Zod pipes may put structured details.
        if (Array.isArray(body.message)) {
          details = (body.message as string[]).map((m) => ({ path: '', message: m }));
          message = 'Validation failed';
          status = HttpStatus.BAD_REQUEST;
          code = 'VALIDATION_FAILED';
        } else {
          message = body.message ?? exception.message;
          if (body.details !== undefined) details = body.details;
          if (body.code) code = body.code;
          if (body.messageKey) messageKeyOverride = body.messageKey;
        }
      }
    } else {
      status = 500;
      code = 'INTERNAL_ERROR';
      message = 'Internal server error';
      details = undefined;
    }

    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        {
          err: {
            message: exception instanceof Error ? exception.message : String(exception),
            stack,
          },
          reqId: requestId,
        },
        `Unhandled exception on ${req.method} ${req.url}`,
      );
      if (!this.config.isProduction) {
        // In non-production give developers the real reason in the response too.
        message = exception instanceof Error ? exception.message : message;
      }
    }

    const payload = {
      ok: false as const,
      error: {
        code,
        messageKey: messageKeyOverride ?? errorMessageKey(code),
        message,
        ...(details !== undefined ? { details } : {}),
        requestId,
      },
    };

    res.status(status).json(payload);
  }

  private codeFromStatus(status: number): ErrorCode {
    for (const [code, http] of Object.entries(ERROR_HTTP_STATUS)) {
      if (http === status) return code as ErrorCode;
    }
    return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED';
  }
}
