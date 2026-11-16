import { dataSource, inTransaction } from '../config/database.config';
import { ProductoSchema, CategoriaSchema } from '../entities/active.schemas';
import { notifyAfterCommit, type NotifyCommittedChange } from '../realtime/committed-change';
import { hasPriceEvidence, priceEvidenceAdminJoin, priceEvidenceJoin, pricingTimestamp } from './priceEvidence';

export interface ProductRecord {
    id_producto: number;
    id_categoria: number;
    codigo: string;
    nombre: string;
    descripcion: string | null;
    precio: string | null;
    stock: number;
    imagen: string | null;
    activo: number | boolean;
    fecha_actualizacion: Date;
}

export interface CreateProductDTO {
    id_categoria: number;
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    precio: number;
    stock: number;
    imagen?: string | null;
    activo?: boolean;
}

export interface UpdateProductDTO {
    id_categoria?: number;
    codigo?: string;
    nombre?: string;
    descripcion?: string | null;
    precio?: number;
    stock?: number;
    imagen?: string | null;
    activo?: boolean;
}

// Explicit raw projections preserve DECIMAL strings, numeric flags and JSON keys.
const fields = ['id_producto', 'id_categoria', 'codigo', 'nombre', 'descripcion', 'precio', 'stock', 'imagen', 'activo', 'fecha_actualizacion'];

function productQuery() {
    const query = dataSource.getRepository(ProductoSchema).createQueryBuilder('p');
    fields.forEach((field, index) => index === 0 ? query.select('p.' + field, field) : query.addSelect('p.' + field, field));
    return query;
}

export type AdminBasePriceState = 'SIN_PRECIO' | 'BASE_CERO' | 'NO_VERIFICADO' | 'VERIFICADO' | 'SINTETICO';

export const findAllAdmin = async (): Promise<(ProductRecord & { estado_precio_base: AdminBasePriceState })[]> => {
    const rows = await productQuery()
        .innerJoin('p.categoria', 'c').addSelect('c.nombre', 'categoria_nombre')
        .leftJoin('PRECIO_USD_EVIDENCIA', 'e', priceEvidenceJoin, { at: pricingTimestamp(new Date()) })
        .leftJoin('USUARIO', 'ea', priceEvidenceAdminJoin)
        .addSelect('ea.id_usuario', 'price_verifier')
        .addSelect('e.evidencia', 'price_evidence')
        .addSelect('e.sintetica', 'price_synthetic')
        .orderBy('p.id_producto', 'DESC')
        .getRawMany<ProductRecord & { price_verifier: number | null; price_evidence: string | null; price_synthetic: number | null }>();
    return rows.map(({ price_verifier, price_evidence, price_synthetic, ...product }) => ({
        ...product,
        estado_precio_base: product.precio === null ? 'SIN_PRECIO'
            : Number(product.precio) === 0 ? 'BASE_CERO'
            : !hasPriceEvidence(price_verifier, price_evidence) ? 'NO_VERIFICADO'
            : price_synthetic === 1 ? 'SINTETICO' : 'VERIFICADO',
    }));
};

export const findById = async (id: number): Promise<ProductRecord | null> =>
    await productQuery().where('p.id_producto = :id', { id }).getRawOne<ProductRecord>() ?? null;

export const findByCodigo = async (codigo: string, excludeId?: number): Promise<ProductRecord | null> => {
    const query = productQuery().where('p.codigo = :codigo', { codigo });
    if (excludeId !== undefined) query.andWhere('p.id_producto <> :excludeId', { excludeId });
    return await query.getRawOne<ProductRecord>() ?? null;
};

export const categoryExists = (id_categoria: number): Promise<boolean> =>
    dataSource.getRepository(CategoriaSchema).existsBy({ id_categoria });

export const create = async (data: CreateProductDTO): Promise<number> => {
    const result = await inTransaction(manager => manager.getRepository(ProductoSchema).insert({
        id_categoria: data.id_categoria,
        codigo: data.codigo.trim(),
        nombre: data.nombre.trim(),
        descripcion: data.descripcion ?? null,
        precio: String(data.precio),
        stock: data.stock,
        imagen: data.imagen ?? null,
        activo: data.activo === undefined ? 1 : Number(data.activo),
    }));
    return Number(result.identifiers[0].id_producto);
};

export const update = async (id: number, data: UpdateProductDTO, notify?: NotifyCommittedChange) => {
    // Never spread HTTP input into an entity; ignored keys stay ignored.
    const values: Record<string, string | number | null> = {};
    for (const field of ['id_categoria', 'codigo', 'nombre', 'descripcion', 'precio', 'stock', 'imagen', 'activo'] as const) {
        const value = data[field];
        if (value === undefined) continue;
        values[field] = field === 'codigo' || field === 'nombre' ? (value as string).trim()
            : field === 'activo' ? Number(value) : field === 'precio' ? String(value) : value as string | number | null;
    }
    if (!Object.keys(values).length) return { updated: false, replacedImage: null };
    const { updated, stockChanged, replacedImage } = await inTransaction(async manager => {
        // Compare under the same row lock as the update, including a PUT with other fields.
        const [before] = data.imagen !== undefined || (notify && data.stock !== undefined)
            ? await manager.query<{ stock: number; imagen: string | null }[]>(
                'SELECT stock, imagen FROM PRODUCTO WHERE id_producto = ? FOR UPDATE', [id],
            )
            : [];
        const result = await manager.getRepository(ProductoSchema).update({ id_producto: id }, values);
        const updated = (result.affected ?? 0) > 0;
        return {
            updated,
            stockChanged: updated && before !== undefined && data.stock !== undefined && before.stock !== data.stock,
            replacedImage: updated && before && data.imagen !== undefined && before.imagen !== data.imagen
                ? before.imagen : null,
        };
    });
    if (stockChanged) notifyAfterCommit(notify, { kind: 'stock', productIds: [id] });
    return { updated, replacedImage };
};

export const deactivate = async (id: number): Promise<boolean> => (await update(id, { activo: false })).updated;
export const updateStock = async (id: number, stock: number, notify?: NotifyCommittedChange): Promise<boolean> =>
    (await update(id, { stock }, notify)).updated;
