import { inTransaction } from '../../config/database.config';
import {
  getAllowedNextStates,
  type AdminOrderListFilters,
  type AdminOrderOperationalStatus,
} from '../../dtos/orders/admin-order.dto';
import {
  findAdminOrderById,
  findAdminOrders,
  lockAdminOrderForStateChange,
  updateAdminOrderStateInTransaction,
  type AdminOrderDetail,
  type AdminOrderListResult,
} from '../../repositories/adminOrder.repository';
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
  orderId: number,
  nextState: AdminOrderOperationalStatus,
): Promise<AdminOrderDetail> {
  return inTransaction(async manager => {
    const current = await lockAdminOrderForStateChange(manager, orderId);
    if (!current) {
      throw new AdminOrderError(
        'PEDIDO_NO_ENCONTRADO',
        404,
        'El pedido solicitado no existe.',
      );
    }

    if (
      current.estado.startsWith('DEMO_') ||
      current.modalidadPago.startsWith('DEMO_')
    ) {
      throw new AdminOrderError(
        'TRANSICION_ESTADO_NO_AUTORIZADA',
        409,
        'Los pedidos de demostración son de solo lectura y no admiten cambios de estado.',
      );
    }

    const allowed = getAllowedNextStates(current.estado, current.modalidadPago);
    if (!allowed.includes(nextState)) {
      throw new AdminOrderError(
        'TRANSICION_ESTADO_NO_AUTORIZADA',
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
        'TRANSICION_ESTADO_NO_AUTORIZADA',
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

    return refreshed;
  });
}