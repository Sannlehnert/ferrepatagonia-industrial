import 'reflect-metadata';
import { createConnection } from 'mysql2/promise';
import { EntityManager, type QueryRunner } from 'typeorm';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { env } from './env.config';
import { SchemaNamingStrategy } from '../entities/schema-naming.strategy';
import { activeSchemas } from '../entities/active.schemas';
import { pool } from './catalog-snapshot.config';
import { ControlledDataSource, SafeDatabaseLogger, DatabaseOutcomeUnknownError } from './database-policy';

export const dataSource = new ControlledDataSource({
  type: 'mariadb', connectorPackage: 'mysql2',
  host: env.db.host, port: env.db.port, username: env.db.user,
  password: env.db.password, database: env.db.database,
  charset: 'utf8mb4_unicode_ci', entities: activeSchemas, namingStrategy: new SchemaNamingStrategy(),
  synchronize: false, dropSchema: false, migrationsRun: false,
  migrations: [], logging: false, logger: new SafeDatabaseLogger(), connectTimeout: 3000,
  enableQueryTimeout: false, maxQueryExecutionTime: 1000,
  extra: { connectionLimit: 5, decimalNumbers: false, waitForConnections: false, queueLimit: 0 },
});
export async function initializeDatabase(): Promise<void> { await dataSource.initialize(); }
export async function destroyDatabase(): Promise<void> {
  try { if (dataSource.isInitialized) await dataSource.destroy(); }
  finally { await pool.end(); }
}
export async function checkDatabase(): Promise<void> {
  // Fixed infrastructure probe, never business persistence or DDL.
  await dataSource.query('SELECT 1');
}

export type ReadQuery = <T>(sql: string, parameters: unknown[]) => Promise<T>;

async function interruptRead(threadId: number): Promise<void> {
  // La conexión que ejecuta la consulta no puede cancelarse a sí misma.
  // Usar una conexión breve de control aunque el pool principal esté ocupado.
  const control = await createConnection({ ...env.db, connectTimeout: 1000 });
  try {
    await control.query({ sql: 'KILL CONNECTION ?', timeout: 1000 }, [threadId]);
  } finally {
    control.destroy();
  }
}

export async function withCancellableRead<T>(
  signal: AbortSignal,
  work: (query: ReadQuery, runner: QueryRunner) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const runner = dataSource.createQueryRunner();
  const connection: { threadId: number; stream: { destroy(): void } } = await runner.connect();
  const query = runner.query.bind(runner);
  let reading = false;
  let cancellation: Promise<void> | undefined;
  runner.query = async (sql: string, parameters?: unknown[], structured?: boolean) => {
    signal.throwIfAborted();
    reading = true;
    try { return await (structured ? query(sql, parameters, true) : query(sql, parameters)); }
    finally { reading = false; }
  };
  const cancel = () => {
    if (!reading) return;
    cancellation = interruptRead(connection.threadId)
      .catch(() => { console.warn('database.read.interrupt.failed'); })
      .finally(() => connection.stream.destroy());
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    return await work((sql, parameters) => runner.query(sql, parameters), runner);
  } finally {
    signal.removeEventListener('abort', cancel);
    await cancellation;
    await runner.release();
  }
}

// Keep one EntityManager and discard a connection whose rollback cannot be confirmed.
export async function inTransaction<T>(work: (manager: EntityManager) => Promise<T>,
  options: { isolation?: IsolationLevel; lockWaitSeconds?: number } = {}): Promise<T> {
  const runner = dataSource.createQueryRunner('master', options.lockWaitSeconds);
  let connection: { destroy(): void } | undefined;
  let committing = false;
  try {
    connection = await runner.connect();
    await runner.startTransaction(options.isolation);
    const result = await work(runner.manager);
    committing = true;
    await runner.commitTransaction();
    return result;
  } catch (error) {
    let uncertain = committing;
    if (runner.isTransactionActive) {
      try { await runner.rollbackTransaction(); }
      catch { uncertain = true; connection?.destroy(); }
    } else {
      // Includes a failed START: do not pool an uncertain session.
      connection?.destroy();
    }
    if (uncertain) throw new DatabaseOutcomeUnknownError();
    throw error;
  } finally {
    await runner.release();
  }
}
