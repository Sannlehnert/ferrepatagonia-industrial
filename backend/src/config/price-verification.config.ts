import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from './env.config';
import { ControlledDataSource, SafeDatabaseLogger } from './database-policy';

let verificationSource: DataSource | undefined;
let initializingSource: Promise<DataSource> | undefined;
let destroyGeneration = 0;

export function priceVerificationConfigured(): boolean {
  return Boolean(env.priceVerification.user && env.priceVerification.password);
}

async function destroySourceSafely(source: DataSource | undefined): Promise<void> {
  if (!source) return;
  try {
    if (source.isInitialized) {
      await source.destroy();
      return;
    }
    const driver = source.driver as {
      pool?: unknown;
      poolCluster?: unknown;
      disconnect?: () => Promise<void>;
    } | undefined;
    if (driver && (driver.pool || driver.poolCluster) && typeof driver.disconnect === 'function') {
      await driver.disconnect();
    }
  } catch {
    // No propagar errores de limpieza secundaria al descartar un pool fallido o cerrado.
  }
}

export async function getPriceVerificationDataSource(): Promise<DataSource | null> {
  if (!priceVerificationConfigured()) return null;
  if (verificationSource?.isInitialized) return verificationSource;
  if (initializingSource) return initializingSource;

  const generation = destroyGeneration;
  const source = new ControlledDataSource({
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
    extra: { connectionLimit: 2, decimalNumbers: false, waitForConnections: true, queueLimit: 10 },
  });

  let pending: Promise<DataSource> | undefined;
  pending = (async () => {
    try {
      await source.initialize();
      if (generation !== destroyGeneration) {
        await destroySourceSafely(source);
        throw new Error('La fuente de verificación de precios fue destruida durante la inicialización.');
      }
      verificationSource = source;
      return source;
    } catch (error) {
      await destroySourceSafely(source);
      throw error;
    } finally {
      if (initializingSource === pending) {
        initializingSource = undefined;
      }
    }
  })();

  initializingSource = pending;
  return pending;
}

export async function destroyPriceVerificationDatabase(): Promise<void> {
  destroyGeneration += 1;
  const source = verificationSource;
  const pending = initializingSource;
  verificationSource = undefined;
  initializingSource = undefined;
  if (pending) {
    await pending.then(initialized => destroySourceSafely(initialized), () => undefined);
  }
  await destroySourceSafely(source);
}
