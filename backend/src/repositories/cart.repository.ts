import { dataSource } from '../config/database.config';
import {
    CarritoSchema,
    ItemCarritoSchema,
    UsuarioSchema
} from '../entities/active.schemas';

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

export const findClienteIdByUsuarioId = async (idUsuario: number): Promise<number | null> => {
    const usuario = await dataSource.getRepository(UsuarioSchema).findOne({
        where: { id_usuario: idUsuario },
        select: ['id_usuario', 'id_cliente']
    });
    return usuario?.id_cliente ?? null;
};

export const getOrCreateCartIdByClientId = async (idCliente: number): Promise<number> => {
    const carritoRepo = dataSource.getRepository(CarritoSchema);

    // 1. Verificación inicial de existencia
    const existing = await carritoRepo.findOne({
        where: { id_cliente: idCliente },
        select: ['id_carrito']
    });

    if (existing) {
        return existing.id_carrito;
    }

    // 2. Inserción atómica controlando colisión concurrente (H01)
    try {
        const insertResult = await carritoRepo.insert({ id_cliente: idCliente });
        const generatedId = insertResult.identifiers?.[0]?.id_carrito;
        if (generatedId) {
            return Number(generatedId);
        }
    } catch (error: any) {
        const isDuplicate =
            error?.code === 'ER_DUP_ENTRY' ||
            error?.driverError?.code === 'ER_DUP_ENTRY' ||
            error?.errno === 1062 ||
            error?.driverError?.errno === 1062 ||
            (typeof error?.message === 'string' && error.message.includes('ER_DUP_ENTRY'));

        if (!isDuplicate) {
            throw error;
        }
    }

    // 3. Recuperar el carrito creado concurrentemente por la solicitud hermana
    const found = await carritoRepo.findOne({
        where: { id_cliente: idCliente },
        select: ['id_carrito']
    });

    if (found) {
        return found.id_carrito;
    }

    // Respaldo de lectura directa en caso de desfase en la metadata
    const rows = await dataSource.query(
        'SELECT id_carrito FROM CARRITO WHERE id_cliente = ? LIMIT 1',
        [idCliente]
    );

    if (rows && rows.length > 0 && rows[0].id_carrito) {
        return Number(rows[0].id_carrito);
    }

    throw new Error('No se pudo inicializar o recuperar el carrito del cliente.');
};

export const findCartItems = async (idCarrito: number): Promise<CartItemRecord[]> => {
    return await dataSource.getRepository(ItemCarritoSchema)
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
