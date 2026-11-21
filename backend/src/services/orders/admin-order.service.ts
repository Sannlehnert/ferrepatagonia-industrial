import { inTransaction } from '../../config/database.config';
import {
  getAllowedNextStates,
  type AdminOrderListFilters,
  type AdminOrderOperationalStatus,
} from '../../dtos/orders/admin-order.dto';
import {
  notifyAfterCommit,
  type NotifyCommittedChange,
} from '../../realtime/committed-change';
import {
  findAdminOrderById,
  findAdminOrders,
  lockAdminOrderForStateChange,
  updateAdminOrderStateInTransaction,
  verifyActiveAdminInTransaction,
  type AdminOrderDetail,
  type AdminOrderListResult,
} from '../../repositories/adminOrder.repository';
import type { AuthContext } from '../../types/auth';
import { AdminOrderError } from './admin-order.errors';

export async function listAdminOrdersService(
  filters: AdminOrderListFilters,
): Promise<AdminOrderListResult> {
  return findAdminOrders(filters);
}

export async function getAdminOrderDetailService(
  orderId: number,
): Promise<AdminOrderDetail> {
  const order = await findAdminOrderById(orderId);
  if (!order) {
    throw new AdminOrderError(
      'PEDIDO_NO_ENCONTRADO',
      404,
      'El pedido solicitado no existe.',
    );
  }
  return order;
}

export async function changeAdminOrderStatusService(
  auth: AuthContext,
  orderId: number,
  nextState: AdminOrderOperationalStatus,
  notify?: NotifyCommittedChange,
): Promise<AdminOrderDetail> {
  const committed = await inTransaction(async manager => {
    // §10.4: PEDIDO FOR UPDATE -> USUARIO (revalidacion ADMIN activo=1 y rol='ADMIN') -> UPDATE PEDIDO
    const current = await lockAdminOrderForStateChange(manager, orderId);

    const actor = await verifyActiveAdminInTransaction(manager, auth.id);
    if (!actor || !actor.activo) {
      throw new AdminOrderError(
        'NO_AUTENTICADO',
        401,
        'No autenticado.',
      );
    }
    if (actor.rol !== 'ADMIN') {
      throw new AdminOrderError(
        'SIN_PERMISO',
        403,
        'El rol autenticado no tiene permiso.',
      );
    }

    if (!current) {
      throw new AdminOrderError(
        'PEDIDO_NO_ENCONTRADO',
        404,
        'El pedido solicitado no existe.',
      );
    }

    if (current.origen === 'DEMO') {
      throw new AdminOrderError(
        'TRANSICION_ESTADO_INVALIDA',
        409,
        'Los pedidos de demostración son de solo lectura y no admiten cambios de estado.',
      );
    }

    const allowed = getAllowedNextStates(current.estado, current.modalidadPago);
    if (!allowed.includes(nextState)) {
      throw new AdminOrderError(
        'TRANSICION_ESTADO_INVALIDA',
        409,
        `No está autorizado cambiar el estado del pedido de ${current.estado} a ${nextState}.`,
      );
    }

    const updated = await updateAdminOrderStateInTransaction(
      manager,
      orderId,
      current.estado,
      nextState,
    );

    if (!updated) {
      throw new AdminOrderError(
        'TRANSICION_ESTADO_INVALIDA',
        409,
        'El estado del pedido cambió durante la operación. Recargá el detalle e intentá nuevamente.',
      );
    }

    const refreshed = await findAdminOrderById(orderId, manager);
    if (!refreshed) {
      throw new AdminOrderError(
        'PEDIDO_NO_ENCONTRADO',
        404,
        'El pedido solicitado no existe.',
      );
    }

    return {
      order: refreshed,
      clientId: current.idCliente,
      estadoAnterior: current.estado,
      estadoNuevo: nextState,
      actualizadoEn: new Date().toISOString(),
    };
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });

  // Emision estrictamente post-COMMIT (§8)
  notifyAfterCommit(notify, {
    kind: 'orderStatus',
    clientId: committed.clientId,
    order: {
      pedidoId: orderId,
      estadoAnterior: committed.estadoAnterior,
      estadoNuevo: committed.estadoNuevo,
      actualizadoEn: committed.actualizadoEn,
    },
  });

  return committed.order;
}
