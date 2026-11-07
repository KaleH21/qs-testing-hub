import { HttpException } from '@nestjs/common';

export interface ErrorDetail {
  path?: string;
  message?: string;
  [k: string]: unknown;
}

/** Lỗi nghiệp vụ có `code` theo bảng docs/05 §1.1 */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message, status);
  }
}
