import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from './env.config';
import { ControlledDataSource, SafeDatabaseLogger } from './database-policy';

let verificationSource: DataSource | null | undefined;

export function priceVerificationConfigured(): boolean {
  return Boolean(env.priceVerification.user && env.priceVerification.password);
}

export async function getPriceVerificationDataSource(): Promise<DataSource | null> {
  if (!priceVerificationConfigured()) return null;
  if (verificationSource?.isInitialized) return verificationSource;
  verificationSource = new ControlledDataSource({
    type: 'mariadb',
    connectorPackage: 'mysql2',
    host: env.db.host,
    port: env.db.port,
    username: env.priceVerification.user!,
    password: env.priceVerification.password!,
    database: env.db.database,
    charset: 'utf8mb4_unicode_ci',
    entities: [],
    synchronize: false,
    dropSchema: false,
    migrationsRun: false,
    migrations: [],
    logging: false,
    logger: new SafeDatabaseLogger(),
    connectTimeout: 3000,
    enableQueryTimeout: false,
    maxQueryExecutionTime: 1000,
    extra: { connectionLimit: 2, decimalNumbers: false, waitForConnections: false, queueLimit: 0 },
  });
  await verificationSource.initialize();
  return verificationSource;
}

export async function destroyPriceVerificationDatabase(): Promise<void> {
  const source = verificationSource;
  verificationSource = undefined;
  if (source?.isInitialized) await source.destroy();
}
