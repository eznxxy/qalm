import { HttpAdapterHost } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import * as express from 'express';
import { APP_CONFIG } from './config.module';
import { AppConfig } from './config';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { GlobalValidationPipe } from './pipes/global-validation.pipe';

/**
 * Shared HTTP wiring (global prefix, body parser, validation pipe, error
 * filter, dev CORS). Used by BOTH main.ts and the integration-test harness
 * so the routes/behavior tests exercise are exactly the production wiring.
 *
 * CORS is allowlist-only: when CORS_DEV_ORIGINS names browser origins,
 * those exact origins are echoed with credentials:true (the web client sends
 * fetch credentials:include so the HttpOnly refresh cookie rides along).
 * Unlisted origins get no ACAO headers; when the list is empty CORS stays
 * disabled entirely. Dev-only — there is no production browser origin.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.use(express.json({ limit: '1mb' }));
  app.useGlobalPipes(new GlobalValidationPipe());

  const httpAdapter = app.get(HttpAdapterHost);
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapter));

  const config = app.get<AppConfig>(APP_CONFIG);
  if (config.corsOrigins.length > 0) {
    app.enableCors({
      origin: config.corsOrigins,
      credentials: true,
    });
  }
}
