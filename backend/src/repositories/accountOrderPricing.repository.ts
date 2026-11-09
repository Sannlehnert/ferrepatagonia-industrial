import type { EntityManager } from 'typeorm';
import { AccountOrderError } from '../services/orders/account-order.errors';

export async function lockAccountOrderPriceInputs(
  manager: EntityManager,
  userId: number,
  cartId: number,
  productIds: number[],
): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('Los precios requieren una transacción activa.');
  }

  const [owner] = await manager.query<{
    listId: number | null;
  }[]>(`
    SELECT c.id_lista_precio AS listId
    FROM USUARIO u
    INNER JOIN CLIENTE c ON c.id_cliente = u.id_cliente
    INNER JOIN CARRITO k ON k.id_cliente = c.id_cliente
    WHERE u.id_usuario = ?
      AND k.id_carrito = ?
      AND u.rol = 'CLIENTE'
      AND u.activo = 1
      AND c.activo = 1
    LOCK IN SHARE MODE
  `, [userId, cartId]);

  if (!owner) {
    throw new AccountOrderError(
      'CLIENTE_NO_HABILITADO',
      403,
      'No se pudo verificar la pertenencia del carrito.',
    );
  }

  if (owner.listId !== null) {
    await manager.query(`
      SELECT id_lista_precio FROM LISTA_PRECIO
      WHERE id_lista_precio = ?
      LOCK IN SHARE MODE
    `, [owner.listId]);
  }

  const adminIds = new Set<number>();

  for (const id of [...new Set(productIds)].sort((a, b) => a - b)) {
    const [evidence] = await manager.query<{ adminId: number }[]>(`
      SELECT id_admin AS adminId
      FROM PRECIO_USD_EVIDENCIA
      WHERE id_producto = ?
      LOCK IN SHARE MODE
    `, [id]);

    if (evidence) adminIds.add(evidence.adminId);
  }

  for (const id of [...adminIds].sort((a, b) => a - b)) {
    await manager.query(`
      SELECT id_usuario FROM USUARIO
      WHERE id_usuario = ?
      LOCK IN SHARE MODE
    `, [id]);
  }
}