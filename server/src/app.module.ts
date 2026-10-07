import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

/**
 * Root module. Feature modules (auth, users, projects) are added by their own
 * cards; this scaffold intentionally contains only infrastructure.
 */
@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
