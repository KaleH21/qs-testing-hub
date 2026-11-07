import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { genRequestId } from './common/request-id';
import { loadEnv } from './config/env';
import { InfraModule } from './infra.module';
import { HealthModule } from './modules/health/health.module';

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        genReqId: genRequestId,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    InfraModule,
    HealthModule,
  ],
})
export class AppModule {}
