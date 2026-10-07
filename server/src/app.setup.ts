import { HttpAdapterHost } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import * as express from 'express';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { GlobalValidationPipe } from './pipes/global-validation.pipe';

/**
 * Shared HTTP wiring (global prefix, body parser, validation pipe, error
 * filter). Used by BOTH main.ts and the integration-test harness so the
 * routes/behavior tests exercise are exactly the production wiring.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.use(express.json({ limit: '1mb' }));
  app.useGlobalPipes(new GlobalValidationPipe());

  const httpAdapter = app.get(HttpAdapterHost);
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapter));
}
