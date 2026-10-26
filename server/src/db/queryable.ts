import { QueryResult, QueryResultRow } from 'pg';

/**
 * Anything that can run a parameterised query: DbService (the pool) or a
 * PoolClient inside DbService.transaction. Stores take an optional Queryable
 * so a whole operation can run on one connection — the transaction boundary
 * stays in the service.
 */
export interface Queryable {
  query<T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}
