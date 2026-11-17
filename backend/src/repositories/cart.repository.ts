import type { EntityManager } from 'typeorm';
import { ItemCarritoSchema } from '../entities/active.schemas';
import { CartLockStatementTimeout, hasDatabaseError } from '../services/cart.errors';

export interface CartItemRecord {
    id_item_carrito: number;
    id_producto: number;
    codigo: string;
    nombre: string;
    imagen: string | null;
    cantidad: number;
    stock: number;
    producto_activo: number;
    categoria_activa: number;
}

async function lockingRead<T>(manager: EntityManager, sql: string, parameters: number[]): Promise<T | undefined> {
    try {
        const [row] = await manager.query<T[]>(sql, parameters);
        return row;
    } catch (error) {
        if (hasDatabaseError(error, 'ER_STATEMENT_TIMEOUT', 1969)) throw new CartLockStatementTimeout(error);
        throw error;
    }
}

export async function findCartClientId(manager: EntityManager, userId: number): Promise<number | null> {
    const [identity] = await manager.query<{ id_cliente: number | null }[]>(`
        SELECT id_cliente FROM USUARIO
        WHERE id_usuario = ? AND rol = 'CLIENTE' AND activo = 1`, [userId]);
    return identity?.id_cliente ?? null;
}

// Credit and FER-20 take CLIENTE before USUARIO. A locking join would let
// MariaDB choose the opposite order. Revalidate the identity after locating it.
export async function lockCartClient(manager: EntityManager, userId: number, clientId: number): Promise<boolean> {
    const client = await lockingRead<{ id_cliente: number }>(manager, `
        SELECT id_cliente FROM CLIENTE WHERE id_cliente = ? AND activo = 1
        FOR UPDATE`, [clientId]);
    if (!client) return false;

    const user = await lockingRead<{ id_cliente: number }>(manager, `
        SELECT id_cliente FROM USUARIO
        WHERE id_usuario = ? AND id_cliente = ? AND rol = 'CLIENTE' AND activo = 1
        FOR UPDATE`, [userId, clientId]);
    return Boolean(user);
}

export async function findCartId(manager: EntityManager, clientId: number): Promise<number | null> {
    const row = await lockingRead<{ id_carrito: number }>(manager,
        'SELECT id_carrito FROM CARRITO WHERE id_cliente = ? FOR UPDATE', [clientId]);
    return row?.id_carrito ?? null;
}

export async function createCart(manager: EntityManager, clientId: number): Promise<number> {
    const result = await manager.query('INSERT INTO CARRITO (id_cliente) VALUES (?)', [clientId]);
    return result.insertId;
}

export async function lockCartProduct(manager: EntityManager, productId: number): Promise<{
    stock: number; producto_activo: number; categoria_activa: number;
} | undefined> {
    return lockingRead(manager, `
        SELECT p.stock, p.activo AS producto_activo, c.activo AS categoria_activa
        FROM PRODUCTO p INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
        WHERE p.id_producto = ? LOCK IN SHARE MODE`, [productId]);
}

export async function findCartItem(manager: EntityManager, cartId: number, productId: number):
    Promise<{ id_item_carrito: number; cantidad: number } | undefined> {
    return lockingRead(manager,
        'SELECT id_item_carrito, cantidad FROM ITEM_CARRITO WHERE id_carrito = ? AND id_producto = ? FOR UPDATE',
        [cartId, productId]);
}

export async function saveCartItem(manager: EntityManager, cartId: number, productId: number,
    quantity: number, existing?: { id_item_carrito: number; cantidad: number }): Promise<boolean> {
    if (!existing) {
        await manager.query('INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, ?, ?)',
            [cartId, productId, quantity]);
        return true;
    }
    if (existing.cantidad !== quantity) {
        await manager.query('UPDATE ITEM_CARRITO SET cantidad = ? WHERE id_carrito = ? AND id_item_carrito = ?',
            [quantity, cartId, existing.id_item_carrito]);
        return true;
    }
    return false;
}

export async function removeCartItem(manager: EntityManager, cartId: number, productId: number): Promise<boolean> {
    const result = await manager.query(
        'DELETE FROM ITEM_CARRITO WHERE id_carrito = ? AND id_producto = ?', [cartId, productId],
    );
    return result.affectedRows > 0;
}

export const findCartItems = async (manager: EntityManager, idCarrito: number): Promise<CartItemRecord[]> => {
    return await manager.getRepository(ItemCarritoSchema)
        .createQueryBuilder('ic')
        .innerJoin('ic.producto', 'p')
        .innerJoin('p.categoria', 'c')
        .select('ic.id_item_carrito', 'id_item_carrito')
        .addSelect('ic.id_producto', 'id_producto')
        .addSelect('p.codigo', 'codigo')
        .addSelect('p.nombre', 'nombre')
        .addSelect('p.imagen', 'imagen')
        .addSelect('ic.cantidad', 'cantidad')
        .addSelect('p.stock', 'stock')
        .addSelect('p.activo', 'producto_activo')
        .addSelect('c.activo', 'categoria_activa')
        .where('ic.id_carrito = :idCarrito', { idCarrito })
        .orderBy('ic.id_item_carrito', 'ASC')
        .getRawMany<CartItemRecord>();
};
