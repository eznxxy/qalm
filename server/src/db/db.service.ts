import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { AppConfig } from '../config';
import { APP_CONFIG } from '../config.module';

/**
 * Single pg Pool for the process. The pool pings the database on module init
 * so a bad DATABASE_URL or unreachable postgres kills the boot immediately
 * instead of failing on the first request.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get db(): Pool {
    if (!this.pool) {
      throw new Error('DbService used before onModuleInit');
    }
    return this.pool;
  }

  async onModuleInit(): Promise<void> {
    this.pool = new Pool({ connectionString: this.config.databaseUrl });
    await this.db.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async query<T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.db.query<T>(text, values);
  }

  /**
   * Runs fn inside a transaction; rolls back on any throw and rethrows.
   * Never cache the client across calls — it is released in every path.
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
