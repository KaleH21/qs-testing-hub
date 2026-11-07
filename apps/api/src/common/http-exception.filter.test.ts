import { Controller, Get, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from './app-error';
import { HttpExceptionFilter } from './http-exception.filter';

@Controller()
class TestController {
  @Get('app-error')
  appError() {
    throw new AppError('TARGET_NOT_ALLOWED', 403, 'Host chưa xác minh', [{ host: 'x.vn' }]);
  }
  @Get('not-found')
  notFound() {
    throw new NotFoundException();
  }
  @Get('boom')
  boom() {
    throw new Error('secret stack detail');
  }
}

describe('HttpExceptionFilter', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [TestController] }).compile();
    app = mod.createNestApplication({ logger: false });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterAll(() => app.close());

  it('giữ code và details của AppError', async () => {
    const res = await request(app.getHttpServer()).get('/app-error').expect(403);
    expect(res.body.error).toMatchObject({
      code: 'TARGET_NOT_ALLOWED',
      details: [{ host: 'x.vn' }],
    });
  });

  it('ánh xạ HttpException sang code chuẩn', async () => {
    const res = await request(app.getHttpServer()).get('/not-found').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('lỗi lạ trả 500 INTERNAL, không lộ chi tiết', async () => {
    const res = await request(app.getHttpServer()).get('/boom').expect(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body)).not.toContain('secret stack detail');
  });
});
