import { dataSource, inTransaction } from '../config/database.config';
import type { EntityManager } from 'typeorm';
import { ProductoSchema, CategoriaSchema } from '../entities/active.schemas';
import { notifyAfterCommit, type NotifyCommittedChange } from '../realtime/committed-change';

export interface ProductRecord {
    id_producto: number;
    id_categoria: number;
    codigo: string;
    nombre: string;
    descripcion: string | null;
    precio: string;
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

function productQuery(manager?: EntityManager) {
    const query = (manager ?? dataSource).getRepository(ProductoSchema).createQueryBuilder('p');
    fields.forEach((field, index) => index === 0 ? query.select('p.' + field, field) : query.addSelect('p.' + field, field));
    return query;
}

const adminListQuery = (manager?: EntityManager) => productQuery(manager)
    .innerJoin('p.categoria', 'c').addSelect('c.nombre', 'categoria_nombre')
    .orderBy('p.id_producto', 'DESC');

export const findAllAdmin = (): Promise<ProductRecord[]> => adminListQuery().getRawMany<ProductRecord>();

export const findAdminPage = (requestedPage: number, limit: number, search?: string) =>
    inTransaction(async manager => {
        const query = adminListQuery(manager);
        if (search !== undefined) {
            const pattern = '%' + search.replace(/[!%_]/g, '!$&') + '%';
            query.andWhere("(p.nombre LIKE :pattern ESCAPE '!' OR p.codigo LIKE :pattern ESCAPE '!')", { pattern });
        }
        const total = await query.getCount();
        const totalPages = Math.ceil(total / limit);
        const page = Math.min(requestedPage, Math.max(1, totalPages));
        const data = total === 0 ? [] : await query
            .offset((page - 1) * limit).limit(limit).getRawMany<ProductRecord>();
        return { data, page, limit, total, totalPages };
    }, { isolation: 'REPEATABLE READ' });

export const findById = async (id: number): Promise<ProductRecord | null> =>
    await productQuery().where('p.id_producto = :id', { id }).getRawOne<ProductRecord>() ?? null;

export const findByCodigo = async (codigo: string, excludeId?: number): Promise<ProductRecord | null> => {
    const query = productQuery().where('p.codigo = :codigo', { codigo });
    if (excludeId !== undefined) query.andWhere('p.id_producto <> :excludeId', { excludeId });
    return await query.getRawOne<ProductRecord>() ?? null;
};

export const categoryExists = (id_categoria: number): Promise<boolean> =>
    dataSource.getRepository(CategoriaSchema).existsBy({ id_categoria });

export const create = async (data: CreateProductDTO, actorId?: number | null): Promise<number> => {
    const result = await inTransaction(async manager => {
        // The FER-17 trigger validates this id again against an active ADMIN.
        await manager.query('SET @fer17_actor_id = ?', [actorId ?? null]);
        try {
            return await manager.getRepository(ProductoSchema).insert({
                id_categoria: data.id_categoria,
                codigo: data.codigo.trim(),
                nombre: data.nombre.trim(),
                descripcion: data.descripcion ?? null,
                precio: String(data.precio),
                stock: data.stock,
                imagen: data.imagen ?? null,
                activo: data.activo === undefined ? 1 : Number(data.activo),
            });
        } finally {
            await manager.query('SET @fer17_actor_id = NULL').catch(() => undefined);
        }
    });
    return Number(result.identifiers[0].id_producto);
};

export const update = async (id: number, data: UpdateProductDTO, notify?: NotifyCommittedChange,
    actorId?: number | null) => {
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
        // The trigger reads this only inside this transaction and revalidates ADMIN.
        await manager.query('SET @fer17_actor_id = ?', [actorId ?? null]);
        try {
            // Compare under the same row lock as the update, including a PUT with other fields.
            const [before] = data.imagen !== undefined || data.precio !== undefined || (notify && data.stock !== undefined)
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
        } finally {
            await manager.query('SET @fer17_actor_id = NULL').catch(() => undefined);
        }
    });
    if (stockChanged) notifyAfterCommit(notify, { kind: 'stock', productIds: [id] });
    return { updated, replacedImage };
};

export const deactivate = async (id: number): Promise<boolean> => (await update(id, { activo: false })).updated;
export const updateStock = async (id: number, stock: number, notify?: NotifyCommittedChange): Promise<boolean> =>
    (await update(id, { stock }, notify)).updated;
