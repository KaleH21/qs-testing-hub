import { RequestMethod, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { HttpExceptionFilter } from './common/http-exception.filter';

/** Cấu hình dùng chung cho main.ts và test tích hợp */
export function configureApp(app: INestApplication): INestApplication {
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  // health và metrics không đi qua /api/v1 (docs/05 §3.15)
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health/{*path}', method: RequestMethod.GET }],
  });
  return app;
}
