import mariadb from 'mariadb';
import { env } from './env';

// Driver provisional: la herramienta de acceso a datos se definirá en equipo.
export const pool = mariadb.createPool({
  ...env.db,
  connectionLimit: 5,
  connectTimeout: 3000,
  acquireTimeout: 5000,
});

export async function checkDatabase(): Promise<void> {
  // pool.query toma una conexión y la devuelve al pool automáticamente.
  await pool.query({ sql: 'SELECT 1', timeout: 3000 });
}
