import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { Server } from 'socket.io';
import { authCookieName } from '../config/auth-cookie.config';
import { dataSource } from '../config/database.config';
import type { HttpSecurityConfig } from '../config/http-security.config';
import { restoreUsuario } from '../services/auth.services';
import type { CommittedChange, NotifyCommittedChange } from './committed-change';
import { verifyToken } from '../services/token.service';
import { allowsSocketTransport, type TrustProxy } from './socket-transport';

const clientRoom = (clientId: number) => `orders:client:${clientId}`;
const adminRoom = 'orders:admin';
const catalogRoom = 'catalog:authenticated';
const orderEvent = 'pedido.confirmado.v1';
const maxPendingChanges = 128;

async function visibleProducts(productIds: readonly number[]): Promise<number[]> {
  const ids = [...new Set(productIds)];
  const rows = await dataSource.query<{ id: number }[]>(`
    SELECT p.id_producto AS id
    FROM PRODUCTO p JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
    WHERE p.activo = 1 AND c.activo = 1 AND p.id_producto IN (${ids.map(() => '?').join(', ')})
    ORDER BY p.id_producto
  `, ids);
  return rows.map(row => row.id);
}

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
  io.on('connection', socket => { void socket.join([socket.data.room, catalogRoom]); });

  async function deliver(change: CommittedChange) {
    const room = change.kind === 'stock' ? undefined : clientRoom(change.clientId);
    const rooms = io.sockets.adapter.rooms;
    const catalog = change.kind === 'cart' ? undefined : rooms.get(catalogRoom);
    let productosIds: number[] = [];
    if (catalog?.size && change.kind !== 'cart' && change.productIds.length) {
      try { productosIds = await visibleProducts(change.productIds); }
      catch { console.error('No se pudo verificar la visibilidad de los productos notificados.'); }
    }
    const recipients = new Set([
      ...(room ? rooms.get(room) ?? [] : []),
      ...(productosIds.length ? catalog ?? [] : []),
    ]);
    const orderPayload = change.kind === 'order' ? {
      version: 1,
      idEvento: `${orderEvent}:${change.order.pedidoId}`,
      pedidoId: change.order.pedidoId,
      estado: change.order.estado,
      notificadoEn: new Date().toISOString(),
    } : undefined;

    for (const id of recipients) {
      const socket = io.sockets.sockets.get(id);
      if (!socket) continue;
      try {
        // Re-read current ownership and authorization immediately before sending.
        const access = await authorizeSocket(socket.request);
        if (!access || access.room !== socket.data.room || !claims(socket.request)) {
          socket.disconnect(true);
          continue;
        }
        if (!socket.connected) continue;
        if (productosIds.length && socket.rooms.has(catalogRoom)) {
          socket.emit('stock.actualizado.v1', { version: 1, productosIds });
        }
        if (access.room === room) {
          socket.emit('carrito.actualizado.v1', { version: 1 });
          if (orderPayload && access.canReceiveOrders) socket.emit(orderEvent, orderPayload);
        }
      } catch {
        console.error('No se pudo notificar a una conexión autorizada.');
      }
    }
  }

  // One bounded, in-process worker. REST never waits for reads or socket delivery.
  const pending: CommittedChange[] = [];
  let draining: Promise<void> | undefined;
  const publish: NotifyCommittedChange = change => {
    if (!io.sockets.sockets.size || pending.length >= maxPendingChanges) return;
    pending.push(change);
    draining ??= new Promise<void>(resolve => {
      setImmediate(async () => {
        try {
          while (pending.length) {
            const next = pending.shift()!;
            try { await deliver(next); }
            catch { console.error('No se pudo publicar un cambio confirmado.'); }
          }
        } finally {
          draining = undefined;
          resolve();
        }
      });
    });
  };
  return { io, publish, waitForNotifications: () => draining ?? Promise.resolve() };
}
