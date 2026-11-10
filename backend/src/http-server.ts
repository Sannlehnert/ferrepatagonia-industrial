import { createServer } from 'node:http';
import { app } from './app';
import { env } from './config/env.config';
import { attachOrderSockets } from './realtime/order-sockets';
import type { RealtimeRequest } from './realtime/committed-change';

export function createBackendServer() {
  const server = createServer(app);
  // Register before Engine.IO wraps the existing REST request listeners.
  server.prependListener('request', (req: RealtimeRequest) => {
    req.notifyCommittedChange = sockets.publish;
  });
  const sockets = attachOrderSockets(server, env.httpSecurity, app.get('trust proxy fn'));

  return {
    server,
    io: sockets.io,
    waitForNotifications: sockets.waitForNotifications,
    async close() {
      // Socket.IO closes its transports and the attached HTTP server.
      await sockets.io.close();
      await sockets.waitForNotifications();
    },
  };
}
