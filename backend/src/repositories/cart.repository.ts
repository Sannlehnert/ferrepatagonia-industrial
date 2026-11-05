import { dataSource, inTransaction } from '../config/database.config';
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
    
    const existing = await carritoRepo.findOne({
        where: { id_cliente: idCliente },
        select: ['id_carrito']
    });

    if (existing) {
        return existing.id_carrito;
    }

    return await inTransaction(async (manager) => {
        const transactionalRepo = manager.getRepository(CarritoSchema);
        const doubleCheck = await transactionalRepo.findOne({
            where: { id_cliente: idCliente },
            select: ['id_carrito']
        });
        
        if (doubleCheck) {
            return doubleCheck.id_carrito;
        }

        try {
            const insertResult = await transactionalRepo.insert({ id_cliente: idCliente });
            return Number(insertResult.identifiers[0].id_carrito);
        } catch (error: any) {
            // Protección idempotente ante inserts concurrentes simultáneos
            if (error?.code === 'ER_DUP_ENTRY') {
                const found = await transactionalRepo.findOne({
                    where: { id_cliente: idCliente },
                    select: ['id_carrito']
                });
                if (found) return found.id_carrito;
            }
            throw error;
        }
    });
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