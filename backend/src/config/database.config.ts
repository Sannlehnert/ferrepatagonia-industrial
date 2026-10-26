import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';
import { env } from './env.config';
import { SchemaNamingStrategy } from '../entities/schema-naming.strategy';
import { activeSchemas } from '../entities/active.schemas';
import { pool } from './catalog-snapshot.config';

export const dataSource = new DataSource({
  type: 'mariadb', connectorPackage: 'mysql2',
  host: env.db.host, port: env.db.port, username: env.db.user,
  password: env.db.password, database: env.db.database,
  charset: 'utf8mb4_unicode_ci', entities: activeSchemas, namingStrategy: new SchemaNamingStrategy(),
  synchronize: false, dropSchema: false, migrationsRun: false,
  migrations: [], logging: false, connectTimeout: 3000,
  enableQueryTimeout: true, maxQueryExecutionTime: 5000,
  extra: { connectionLimit: 5, decimalNumbers: false },
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

// Keep one EntityManager and discard a connection whose rollback cannot be confirmed.
export async function inTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  let connection: { destroy(): void } | undefined;
  try {
    connection = await runner.connect();
    await runner.startTransaction();
    const result = await work(runner.manager);
    await runner.commitTransaction();
    return result;
  } catch (error) {
    if (runner.isTransactionActive) {
      try { await runner.rollbackTransaction(); }
      catch { connection?.destroy(); }
    } else {
      // Includes a failed START: do not pool an uncertain session.
      connection?.destroy();
    }
    throw error;
  } finally {
    await runner.release();
  }
}
