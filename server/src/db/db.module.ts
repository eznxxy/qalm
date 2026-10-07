import { Module } from '@nestjs/common';
import { DbService } from './db.service';

/** Provides the shared pg pool; imported by every feature that touches SQL. */
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
