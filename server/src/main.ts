import 'reflect-metadata';
import * as express from 'express';
import { NestFactory, HttpAdapterHost, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfigFromFile } from './config';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { GlobalValidationPipe } from './pipes/global-validation.pipe';

/**
 * Entry point. Boot order:
 *  1. validate env (fail-fast, before listening)
 *  2. create the Nest app (default Express adapter, JSON body parsing with a
 *     1 MB limit, default parser disabled so ours owns the configuration)
 *  3. register the global validation pipe and error filter
 *  4. listen on PORT (fixed 3001 in dev — the web app assumes it)
 */
async function bootstrap(): Promise<void> {
  const config = loadConfigFromFile();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  app.setGlobalPrefix('api/v1');
  app.use(express.json({ limit: '1mb' }));
  app.useGlobalPipes(new GlobalValidationPipe());

  const httpAdapter = app.get(HttpAdapterHost);
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapter));
  void app.get(Reflector); // reserved for future guards; keeps DI graph warm

  await app.listen(config.port, '0.0.0.0');
  console.log(`Qalm API listening on http://localhost:${config.port}/api/v1`);
}

void bootstrap();
