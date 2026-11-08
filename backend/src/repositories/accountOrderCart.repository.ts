import type { EntityManager } from 'typeorm';
import { findCartId, lockCartClient } from './cart.repository';
import { AccountOrderError } from '../services/orders/account-order.errors';

interface CartLine {
  itemId: number;
  productId: number;
  quantity: number;
}

interface Product {
  categoryId: number;
  stock: number;
  active: number;
}

export interface LockedOrderCart {
  cartId: number;
  items: CartLine[];
}

function requireTransaction(manager: EntityManager): void {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('El carrito requiere una transacción activa.');
  }
}

function validQuantity(value: number): boolean {
  return Number.isInteger(value) &&
    value > 0 &&
    value <= 2147483647;
}

function conflict(): AccountOrderError {
  return new AccountOrderError(
    'CARRITO_MODIFICADO',
    409,
    'El carrito cambió. Consultalo antes de volver a confirmar.',
  );
}

// El servicio debe bloquear primero la cuenta corriente.
export async function lockAccountOrderCart(
  manager: EntityManager,
  userId: number,
  clientId: number,
): Promise<LockedOrderCart> {
  requireTransaction(manager);

  if (await lockCartClient(manager, userId) !== clientId) {
    throw new AccountOrderError(
      'CLIENTE_NO_HABILITADO',
      403,
      'La cuenta de cliente no está habilitada.',
    );
  }

  const cartId = await findCartId(manager, clientId);
  const items = cartId === null ? [] : await manager.query<CartLine[]>(`
    SELECT
      id_item_carrito AS itemId,
      id_producto AS productId,
      cantidad AS quantity
    FROM ITEM_CARRITO
    WHERE id_carrito = ?
    ORDER BY id_producto
    FOR UPDATE
  `, [cartId]);

  if (cartId === null || items.length === 0) {
    throw new AccountOrderError(
      'CARRITO_VACIO',
      422,
      'El carrito está vacío.',
    );
  }

  const categories = new Set<number>();

  // Orden estable para carritos que comparten productos.
  for (const item of items) {
    if (!validQuantity(item.quantity)) {
      throw new AccountOrderError(
        'CANTIDAD_INVALIDA',
        422,
        'El carrito contiene una cantidad inválida.',
      );
    }

    const [product] = await manager.query<Product[]>(`
      SELECT id_categoria AS categoryId, stock, activo AS active
      FROM PRODUCTO
      WHERE id_producto = ?
      FOR UPDATE
    `, [item.productId]);

    if (!product || product.active !== 1) {
      throw new AccountOrderError(
        'PRODUCTO_INACTIVO',
        422,
        'El carrito contiene un producto no disponible.',
      );
    }

    if (product.stock < item.quantity) {
      throw new AccountOrderError(
        'STOCK_INSUFICIENTE',
        409,
        'El stock disponible no alcanza para confirmar el pedido.',
      );
    }

    categories.add(product.categoryId);
  }

  for (const categoryId of [...categories].sort((a, b) => a - b)) {
    const [category] = await manager.query<{ active: number }[]>(`
      SELECT activo AS active
      FROM CATEGORIA
      WHERE id_categoria = ?
      LOCK IN SHARE MODE
    `, [categoryId]);

    if (!category || category.active !== 1) {
      throw new AccountOrderError(
        'CATEGORIA_INACTIVA',
        422,
        'El carrito contiene una categoría no disponible.',
      );
    }
  }

  return { cartId, items };
}

export async function consumeAccountOrderCart(
  manager: EntityManager,
  cart: LockedOrderCart,
): Promise<void> {
  requireTransaction(manager);

  for (const item of cart.items) {
    if (!validQuantity(item.quantity)) throw conflict();

    const stock = await manager.query(`
      UPDATE PRODUCTO
      SET stock = stock - ?
      WHERE id_producto = ?
        AND activo = 1
        AND stock >= ?
    `, [item.quantity, item.productId, item.quantity]);

    if (stock.affectedRows !== 1) throw conflict();

    const removed = await manager.query(`
      DELETE FROM ITEM_CARRITO
      WHERE id_carrito = ?
        AND id_item_carrito = ?
        AND id_producto = ?
        AND cantidad = ?
    `, [cart.cartId, item.itemId, item.productId, item.quantity]);

    if (removed.affectedRows !== 1) throw conflict();
  }
}