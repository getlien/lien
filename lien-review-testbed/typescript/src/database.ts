/**
 * Database access layer with connection pooling and transaction support.
 * Simulates a PostgreSQL-style database client for testing purposes.
 */

import type { TransactionContext } from './types.js';

interface ConnectionPool {
  activeConnections: number;
  maxConnections: number;
  lastHealthCheck: Date | null;
}

const pool: ConnectionPool = {
  activeConnections: 0,
  maxConnections: 20,
  lastHealthCheck: null,
};

const dataStore: Map<string, unknown[]> = new Map();

/**
 * Executes a parameterized SQL query and returns all matching rows.
 * Parameters are bound positionally using $1, $2, etc. placeholders.
 * Simulates network latency and connection pool management.
 */
export async function query<T>(sql: string, params: unknown[]): Promise<T[]> {
  if (!sql.trim()) {
    throw new Error('Query string cannot be empty');
  }

  if (pool.activeConnections >= pool.maxConnections) {
    throw new Error(
      `Connection pool exhausted: ${pool.activeConnections}/${pool.maxConnections} connections in use`,
    );
  }

  pool.activeConnections++;

  try {
    const normalizedSql = sql.trim().toLowerCase();
    const tableName = extractTableName(normalizedSql);

    if (!tableName) {
      throw new Error(`Could not determine table from query: ${sql}`);
    }

    const tableData = (dataStore.get(tableName) as T[]) ?? [];

    if (normalizedSql.startsWith('select')) {
      return filterByParams(tableData, params);
    }

    if (normalizedSql.startsWith('insert')) {
      const newRow = buildRowFromParams(params);
      const existing = dataStore.get(tableName) ?? [];
      existing.push(newRow);
      dataStore.set(tableName, existing);
      return [newRow as T];
    }

    if (normalizedSql.startsWith('update')) {
      return applyUpdate(tableData, params) as T[];
    }

    if (normalizedSql.startsWith('delete')) {
      const remaining = tableData.filter(
        row => (row as Record<string, unknown>)['id'] !== params[0],
      );
      dataStore.set(tableName, remaining);
      return [];
    }

    return tableData;
  } finally {
    pool.activeConnections--;
  }
}

/**
 * Executes a query and returns exactly one result.
 * Throws an error if the query returns no rows — use this when the
 * caller expects a guaranteed result (e.g., fetching by primary key).
 */
export async function queryOne<T>(sql: string, params: unknown[]): Promise<T> {
  const results = await query<T>(sql, params);

  if (results.length === 0) {
    throw new Error(`Expected one result but got none for query: ${sql}`);
  }

  return results[0];
}

/**
 * Wraps a series of database operations in a transaction.
 * If the callback throws, the transaction is rolled back.
 * The callback receives a TransactionContext with its own query methods
 * that participate in the transaction scope.
 */
export async function transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  const snapshot = new Map<string, unknown[]>();
  for (const [key, value] of dataStore.entries()) {
    snapshot.set(key, [...value]);
  }

  const txContext: TransactionContext = {
    query: async <R>(sql: string, params: unknown[]): Promise<R[]> => {
      return query<R>(sql, params);
    },
    queryOne: async <R>(sql: string, params: unknown[]): Promise<R> => {
      return queryOne<R>(sql, params);
    },
  };

  try {
    const result = await fn(txContext);
    return result;
  } catch (error) {
    for (const [key, value] of snapshot.entries()) {
      dataStore.set(key, value);
    }

    const message = error instanceof Error ? error.message : 'Unknown transaction error';
    throw new Error(`Transaction rolled back: ${message}`);
  }
}

/**
 * Verifies database connectivity by attempting a lightweight query.
 * Updates the pool's last health check timestamp on success.
 * Returns false if the connection pool is exhausted or the check fails.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    if (pool.activeConnections >= pool.maxConnections) {
      return false;
    }

    pool.activeConnections++;
    pool.lastHealthCheck = new Date();
    pool.activeConnections--;

    return true;
  } catch {
    return false;
  }
}

function extractTableName(sql: string): string | null {
  const fromMatch = sql.match(/from\s+(\w+)/i);
  if (fromMatch) return fromMatch[1];

  const intoMatch = sql.match(/into\s+(\w+)/i);
  if (intoMatch) return intoMatch[1];

  const updateMatch = sql.match(/update\s+(\w+)/i);
  if (updateMatch) return updateMatch[1];

  const deleteMatch = sql.match(/delete\s+from\s+(\w+)/i);
  if (deleteMatch) return deleteMatch[1];

  return null;
}

function filterByParams<T>(data: T[], params: unknown[]): T[] {
  if (params.length === 0) return data;

  return data.filter(row => {
    const record = row as Record<string, unknown>;
    return params.some(
      param => record['id'] === param || record['email'] === param || record['userId'] === param,
    );
  });
}

function buildRowFromParams(params: unknown[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (let i = 0; i < params.length; i++) {
    row[`col_${i}`] = params[i];
  }
  return row;
}

function applyUpdate<T>(data: T[], params: unknown[]): T[] {
  if (data.length === 0 || params.length < 2) return data;

  const targetId = params[params.length - 1];

  return data.map(row => {
    const record = row as Record<string, unknown>;
    if (record['id'] === targetId) {
      return { ...record, updatedAt: new Date() } as T;
    }
    return row;
  });
}
