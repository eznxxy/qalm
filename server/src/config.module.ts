import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig, loadConfigFromFile } from './config';

/**
 * Injection token for the validated boot configuration (see config.ts).
 * loadConfigFromFile() reads server/.env (dotenv does not override existing
 * process.env values) and fail-fast validates; main.ts already ran it once
 * before boot, so calling it again here is deterministic and cheap.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Global module exposing the validated AppConfig to every feature module
 * without re-import plumbing. Kept separate from config.ts so config.ts stays
 * framework-free and unit-testable.
 */
@Global()
@Module({})
export class ConfigModule {
  static register(): DynamicModule {
    const config: AppConfig = loadConfigFromFile();
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
