import { createBackendServer } from './http-server';
import { env } from './config/env.config';
import { initializeDatabase, destroyDatabase } from './config/database.config';

async function main(): Promise<void> {
  await initializeDatabase();
  const { server, close } = createBackendServer();
  server.on('listening', () => console.log('API disponible en puerto ' + env.port));
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await close();
    } catch {
      process.exitCode = 1;
    } finally {
      try { await destroyDatabase(); }
      catch { process.exitCode = 1; }
    }
  };
  server.on('error', () => {
    console.error('No se pudo iniciar el servidor.');
    process.exitCode = 1;
    void shutdown();
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.listen(env.port);
}
main().catch(async () => {
  console.error('No se pudo inicializar la base de datos.');
  try { await destroyDatabase(); } finally { process.exitCode = 1; }
});
