import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig, loadConfigFromFile } from './config';

/**
 * Injection token for the validated boot configuration (see config.ts).
 */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Global module exposing the validated AppConfig to every feature module
 * without re-import plumbing.
 *
 * The provider is a FACTORY on purpose: @Module decorators are evaluated at
 * module-import time, but the config itself must be read at DI-instantiation
 * time (main.ts already validated env before boot; tests load .env.test into
 * process.env before creating the testing module). Keeping the read inside
 * useFactory makes import order irrelevant.
 */
@Global()
@Module({})
export class ConfigModule {
  static register(): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [
        { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfigFromFile() },
      ],
      exports: [APP_CONFIG],
    };
  }
}
