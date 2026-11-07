import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { validationFailed } from './errors';

/** Validate body/query bằng schema dùng chung ở @qah/validation (docs/05 §1); field lạ bị bỏ */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value ?? {});
    if (parsed.success) return parsed.data;
    throw validationFailed(
      'Dữ liệu không hợp lệ',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
}
