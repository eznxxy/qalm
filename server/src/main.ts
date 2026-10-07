import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfigFromFile } from './config';
import { configureApp } from './app.setup';

/**
 * Entry point. Boot order:
 *  1. validate env (fail-fast, before listening)
 *  2. create the Nest app (default parser disabled so app.setup.ts owns the
 *     JSON body-parser configuration with a 1 MB limit)
 *  3. shared wiring from app.setup.ts (prefix, body parser, pipes, filter) —
 *     the integration suite applies the identical wiring to the test app
 *  4. listen on PORT (fixed 3001 in dev — the web app assumes it)
 */
async function bootstrap(): Promise<void> {
  const config = loadConfigFromFile();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  configureApp(app);

  await app.listen(config.port, '0.0.0.0');
  console.log(`Qalm API listening on http://localhost:${config.port}/api/v1`);
}

void bootstrap();
