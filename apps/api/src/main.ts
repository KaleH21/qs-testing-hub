import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { ENV, type Env } from './config/env';
import { runMigrations } from './db/migrate';
import { MigrationState } from './infra.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();
  configureApp(app);

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('QA Testing Hub API').setVersion('1').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs.json' });

  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, '0.0.0.0');

  // listen trước để /health/live trả lời; /health/ready = false cho tới khi migration xong
  try {
    await runMigrations(env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL);
    app.get(MigrationState).done = true;
    logger.log('Migration xong, API sẵn sàng');
  } catch (err) {
    logger.error(err, 'Migration thất bại');
    await app.close();
    process.exit(1);
  }
}

void bootstrap();
