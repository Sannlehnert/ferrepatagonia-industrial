import type { Request, Response } from 'express';
import { mutationErrorMessage } from '../config/database-policy';
import {
  parseAdminOrderIdParam,
  parseAdminOrderListQuery,
  parseAdminOrderStatusBody,
} from '../dtos/orders/admin-order.dto';
import { AdminOrderError } from '../services/orders/admin-order.errors';
import {
  changeAdminOrderStatusService,
  getAdminOrderDetailService,
  listAdminOrdersService,
} from '../services/orders/admin-order.service';

export async function getAdminOrders(req: Request, res: Response) {
  try {
    const filters = parseAdminOrderListQuery(req.query as Record<string, unknown>);
    const data = await listAdminOrdersService(filters);
    return res.status(200).json({ data });
  } catch (error) {
    if (error instanceof AdminOrderError) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
      });
    }
    return res.status(500).json({
      message: 'No se pudo consultar el listado de pedidos.',
    });
  }
}

export async function getAdminOrderById(req: Request, res: Response) {
  try {
    const orderId = parseAdminOrderIdParam(req.params.id);
    const data = await getAdminOrderDetailService(orderId);
    return res.status(200).json({ data });
  } catch (error) {
    if (error instanceof AdminOrderError) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
      });
    }
    return res.status(500).json({
      message: 'No se pudo consultar el detalle del pedido.',
    });
  }
}

export async function updateAdminOrderStatus(req: Request, res: Response) {
  try {
    const orderId = parseAdminOrderIdParam(req.params.id);
    const { estado } = parseAdminOrderStatusBody(req.body);
    const data = await changeAdminOrderStatusService(orderId, estado);
    return res.status(200).json({
      message: 'Estado del pedido actualizado correctamente.',
      data,
    });
  } catch (error) {
    if (error instanceof AdminOrderError) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
      });
    }
    return res.status(500).json({
      message: mutationErrorMessage(error),
    });
  }
}