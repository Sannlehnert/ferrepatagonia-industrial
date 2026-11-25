import { DataSource, Logger, QueryRunner } from 'typeorm';

// No query text, parameters, driver errors, entities or arbitrary messages enter logs.
export class SafeDatabaseLogger implements Logger {
  logQuery(): void {}
  logQueryError(): void { console.error('database.query.failed'); }
  logQuerySlow(milliseconds: number): void {
    console.warn('database.query.slow', { milliseconds: Number.isFinite(milliseconds) ? milliseconds : 0 });
  }
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

interface PooledConnectionLike {
  release?: () => void;
}

interface MysqlPoolLike {
  getConnection(callback: (error: unknown, connection?: PooledConnectionLike) => void): void;
}

const DEFAULT_POOL_ACQUIRE_TIMEOUT_MS = 1200;
const boundedPools = new WeakSet<object>();

function attachBoundedPoolAcquire(pool: MysqlPoolLike, timeoutMs: number): void {
  if (boundedPools.has(pool)) return;
  boundedPools.add(pool);
  const originalGetConnection = pool.getConnection.bind(pool);
  pool.getConnection = callback => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      callback(Object.assign(new Error('No connections available.'), { code: 'POOL_NO_CONNECTIONS' }));
    }, timeoutMs);
    timer.unref?.();
    originalGetConnection((error, connection) => {
      clearTimeout(timer);
      if (settled) {
        if (!error && connection?.release) {
          try { connection.release(); } catch {}
        }
        return;
      }
      settled = true;
      callback(error, connection);
    });
  };
}

export class ControlledDataSource extends DataSource {
  override async initialize(): Promise<this> {
    await super.initialize();
    const driver = this.driver as { pool?: MysqlPoolLike } | undefined;
    if (driver?.pool && typeof driver.pool.getConnection === 'function') {
      attachBoundedPoolAcquire(driver.pool, DEFAULT_POOL_ACQUIRE_TIMEOUT_MS);
    }
    return this;
  }

  override createQueryRunner(mode: 'master' | 'slave' = 'master', lockWaitSeconds = 5): QueryRunner {
    const runner = super.createQueryRunner(mode);
    const query = runner.query.bind(runner);
    runner.query = (sql: string, parameters?: unknown[], structured?: boolean) => {
      // Fixed MariaDB statement-scoped limits: no session leakage and no client
      // timer that abandons a still-running mutation. Transaction control is not wrapped.
      const bounded = /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
        ? `SET STATEMENT max_statement_time=5, innodb_lock_wait_timeout=${lockWaitSeconds} FOR ` + sql : sql;
      return structured ? query(bounded, parameters, true) : query(bounded, parameters);
    };
    return runner;
  }
}

export class DatabaseOutcomeUnknownError extends Error {
  readonly code = 'DATABASE_OUTCOME_UNKNOWN';
  constructor() {
    super('No se pudo confirmar el resultado de la operación. Verificá el estado antes de reintentar.');
  }
}
export function mutationErrorMessage(error: unknown): string {
  return error instanceof DatabaseOutcomeUnknownError ? error.message : 'Error interno del servidor';
}

const TRANSIENT_DATABASE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_TOO_MANY_USER_CONNECTIONS',
  'ER_USER_LIMIT_REACHED',
  'ER_SERVER_SHUTDOWN',
  'ER_STATEMENT_TIMEOUT',
  'ER_QUERY_TIMEOUT',
  'ER_LOCK_WAIT_TIMEOUT',
  'POOL_ENQUEUELIMIT',
  'POOL_NO_CONNECTIONS',
  'POOL_CLOSED',
]);

// mysql2 does not name MariaDB's ER_STATEMENT_TIMEOUT (1969) in its error table.
const TRANSIENT_DATABASE_ERRNOS = new Set([1040, 1203, 1205, 1226, 1969]);

const TRANSIENT_POOL_MESSAGES = new Set([
  'No connections available.',
  'Queue limit reached.',
  'Pool is closed.',
]);

export function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  type DriverFailure = { code?: string; errno?: number; message?: string; driverError?: DriverFailure; cause?: unknown };
  const visited = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    const candidate = current as DriverFailure;
    if (candidate.code && TRANSIENT_DATABASE_CODES.has(candidate.code)) return true;
    if (typeof candidate.errno === 'number' && TRANSIENT_DATABASE_ERRNOS.has(candidate.errno)) return true;
    if (typeof candidate.message === 'string' && TRANSIENT_POOL_MESSAGES.has(candidate.message)) return true;
    if (candidate.driverError) queue.push(candidate.driverError);
    if (candidate.cause) queue.push(candidate.cause);
  }
  return false;
}

