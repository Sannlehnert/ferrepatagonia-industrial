import { app } from './app';
import { env } from './config/env.config';
import { initializeDatabase, destroyDatabase } from './config/database.config';

async function main(): Promise<void> {
  await initializeDatabase();
  const server = app.listen(env.port);
  server.on('listening', () => console.log('API disponible en puerto ' + env.port));
  server.on('error', async () => {
    console.error('No se pudo iniciar el servidor.');
    await destroyDatabase();
    process.exitCode = 1;
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      try { await destroyDatabase(); }
      catch { process.exitCode = 1; }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
main().catch(async () => {
  console.error('No se pudo inicializar la base de datos.');
  try { await destroyDatabase(); } finally { process.exitCode = 1; }
});
