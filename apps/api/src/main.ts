import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { APP_CONFIG } from './config/config.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const config = app.get(APP_CONFIG);
  await app.listen(config.apiPort, '0.0.0.0');

  const logger = new Logger('bootstrap');
  logger.log(`API listening on http://localhost:${config.apiPort}/api/v1/health`);
}

void bootstrap();
