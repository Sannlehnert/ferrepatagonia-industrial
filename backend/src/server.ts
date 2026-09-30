import { app } from './app';
import { env } from './config/env';
import { pool } from './config/database';

const server = app.listen(env.port);

server.on('listening', () => {
  console.log(`API disponible en http://localhost:${env.port}/api/health`);
});

server.on('error', async (error) => {
  console.error(`No se pudo iniciar el servidor: ${error.message}`);
  await pool.end();
  process.exitCode = 1;
});

function shutdown(): void {
  server.close(async () => {
    await pool.end();
    process.exitCode = 0;
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
