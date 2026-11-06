import {
    getOrCreateCartIdByClientId,
    findCartItems,
    findClienteIdByUsuarioId
} from '../repositories/cart.repository';

export interface CartItemDTO {
    id_item_carrito: number;
    id_producto: number;
    codigo: string;
    nombre: string;
    imagen: string | null;
    cantidad: number;
    stock: number;
    disponible: boolean;
    motivo_no_disponible?: 'INACTIVO' | 'SIN_STOCK';
}

export interface CartResponseDTO {
    id_carrito: number;
    items: CartItemDTO[];
    total_items: number;
    tiene_incompatibles: boolean;
}

export const getAuthenticatedClientCart = async (idUsuario: number): Promise<CartResponseDTO | null> => {
    const idCliente = await findClienteIdByUsuarioId(idUsuario);
    if (!idCliente) {
        return null;
    }

    const idCarrito = await getOrCreateCartIdByClientId(idCliente);
    const rawItems = await findCartItems(idCarrito);

    let totalItems = 0;
    let tieneIncompatibles = false;

    const items: CartItemDTO[] = rawItems.map((raw) => {
        const esActivo = Boolean(Number(raw.producto_activo) && Number(raw.categoria_activa));
        const cantidadPedida = Number(raw.cantidad);
        const stockActual = Number(raw.stock);

        // H02: Solo disponible si el producto y categoría están activos Y el stock cubre la cantidad pedida
        const tieneStock = stockActual >= cantidadPedida;
        const disponible = esActivo && tieneStock;

        let motivo: 'INACTIVO' | 'SIN_STOCK' | undefined;
        if (!esActivo) {
            motivo = 'INACTIVO';
            tieneIncompatibles = true;
        } else if (!tieneStock) {
            motivo = 'SIN_STOCK';
            tieneIncompatibles = true;
        }

        if (esActivo) {
            totalItems += cantidadPedida;
        }

        return {
            id_item_carrito: Number(raw.id_item_carrito),
            id_producto: Number(raw.id_producto),
            codigo: raw.codigo,
            nombre: raw.nombre,
            imagen: raw.imagen,
            cantidad: cantidadPedida,
            stock: stockActual,
            disponible,
            motivo_no_disponible: motivo
        };
    });

    return {
        id_carrito: idCarrito,
        items,
        total_items: totalItems,
        tiene_incompatibles: tieneIncompatibles
    };
};
