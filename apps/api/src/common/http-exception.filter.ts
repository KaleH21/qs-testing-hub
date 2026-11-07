import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, type ErrorDetail } from './app-error';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  503: 'DEPENDENCY_UNAVAILABLE',
};

/** Định dạng lỗi thống nhất (docs/05 §1.1); không bao giờ trả stack trace */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: number }>();
    const res = ctx.getResponse<Response>();

    let status = 500;
    let code = 'INTERNAL';
    let message = 'Lỗi hệ thống';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      message = status >= 500 ? message : exception.message;
    }

    if (status >= 500) this.logger.error(exception);

    res.status(status).json({
      error: { code, message, ...(details ? { details } : {}), requestId: req.id },
    });
  }
}
