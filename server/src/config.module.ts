import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from './config';

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
 * time. Keeping the read inside useFactory makes import order irrelevant.
 *
 * The factory validates `process.env` and deliberately does NOT read a file:
 * loading the environment is the entrypoint's job — main.ts calls
 * loadConfigFromFile() (.env) and the integration harness calls loadTestEnv()
 * (.env.test). A file read here made the dev .env leak into the e2e run,
 * refilling variables a test had just unset (e.g. CORS_DEV_ORIGINS).
 */
@Global()
@Module({})
export class ConfigModule {
  static register(): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig(process.env) }],
      exports: [APP_CONFIG],
    };
  }
}
