import mariadb from 'mariadb';
import { env } from './env.config';
// Catalog-only exception: exact snapshot start, server timeout and discard on error.
// No application writes or other repositories may use this adapter.
export const pool = mariadb.createPool({
  ...env.db, connectionLimit: 5, connectTimeout: 3000, acquireTimeout: 5000,
});
