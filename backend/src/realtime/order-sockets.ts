import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { Server } from 'socket.io';
import { authCookieName } from '../config/auth-cookie.config';
import { dataSource } from '../config/database.config';
import type { HttpSecurityConfig } from '../config/http-security.config';
import { restoreUsuario } from '../services/auth.services';
import type { NotifyAccountOrderConfirmed } from '../services/orders/account-order.types';
import { verifyToken } from '../services/token.service';
import { allowsSocketTransport, type TrustProxy } from './socket-transport';

const clientRoom = (clientId: number) => `orders:client:${clientId}`;
const adminRoom = 'orders:admin';
const event = 'pedido.confirmado.v1';

function claims(req: IncomingMessage) {
  const token: unknown = (req as Request).cookies?.[authCookieName];
  if (typeof token !== 'string') return null;
  try { return verifyToken(token); }
  catch { return null; }
}

async function authorizeSocket(req: IncomingMessage) {
  const auth = claims(req);
  if (!auth || !await restoreUsuario(auth)) return null;
  if (auth.rol === 'ADMIN') return { room: adminRoom, canReceiveOrders: false };

  const [client] = await dataSource.query<{ clientId: number; canReceiveOrders: number }[]>(`
    SELECT c.id_cliente AS clientId,
           COALESCE(c.tipo_cliente = 'EMPRESA' AND c.estado_aprobacion_empresa = 'APROBADA'
             AND cc.habilitada = 1, 0) AS canReceiveOrders
    FROM USUARIO u
    JOIN CLIENTE c ON c.id_cliente = u.id_cliente
    LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = c.id_cliente
    WHERE u.id_usuario = ? AND u.rol = 'CLIENTE' AND u.activo = 1 AND c.activo = 1
  `, [auth.id]);

  return client && {
    room: clientRoom(client.clientId), canReceiveOrders: client.canReceiveOrders === 1,
  };
}

export function attachOrderSockets(
  http: HttpServer, config: HttpSecurityConfig, trustProxy: TrustProxy,
) {
  const io = new Server(http, { serveClient: false });
  const parseCookies = cookieParser();

  // Engine middleware runs on polling and WebSocket, including upgrades.
  io.engine.use((req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    if (!allowsSocketTransport(req, config, trustProxy)) {
      next(new Error('Transporte no permitido.'));
      return;
    }
    parseCookies(req as Request, res as Response, next);
  });

  io.use(async (socket, next) => {
    try {
      const access = await authorizeSocket(socket.request);
      if (!access || !claims(socket.request)) {
        next(new Error('NO_AUTENTICADO'));
        return;
      }
      socket.data.room = access.room;
    } catch {
      next(new Error('AUTENTICACION_NO_DISPONIBLE'));
      return;
    }
    next();
  });
  io.on('connection', socket => { void socket.join(socket.data.room); });

  const publish: NotifyAccountOrderConfirmed = async (clientId, order) => {
    const room = clientRoom(clientId);
    const payload = {
      version: 1,
      idEvento: `pedido.confirmado.v1:${order.pedidoId}`,
      pedidoId: order.pedidoId,
      estado: order.estado,
      notificadoEn: new Date().toISOString(),
    };
    for (const id of [...(io.sockets.adapter.rooms.get(room) ?? [])]) {
      const socket = io.sockets.sockets.get(id);
      if (!socket) continue;
      try {
        // Re-read current ownership and authorization immediately before sending.
        const access = await authorizeSocket(socket.request);
        if (!access || access.room !== room || !claims(socket.request)) {
          socket.disconnect(true);
        } else if (access.canReceiveOrders && socket.connected) {
          socket.emit(event, payload);
        }
      } catch {
        console.error('No se pudo notificar a una conexión autorizada.');
      }
    }
  };
  return { io, publish };
}
