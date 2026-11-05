import { dataSource, inTransaction } from '../config/database.config';
import { CategoriaSchema, ProductoSchema } from '../entities/active.schemas';
import { normalizeSkuKey } from '../utils/importConfirmationState.util';

export interface DuplicateSkuResult {
    rowNumber: number;
    firstSeenRow: number;
}

export interface InsertProductRowResult {
    success: boolean;
    id_producto?: number;
    codigo: string;
    nombre: string;
    error?: string;
    isDuplicateConflict?: boolean;
}

export const normalizeSkuForComparison = normalizeSkuKey;

export const findFileSkuDuplicates = async (
    items: Array<{ rowNumber: number; codigo: string }>
): Promise<DuplicateSkuResult[]> => {
    if (items.length <= 1) {
        return [];
    }

    if (!dataSource.isInitialized) {
        const results: DuplicateSkuResult[] = [];
        const seen = new Map<string, number>();
        for (const item of items) {
            const key = normalizeSkuForComparison(item.codigo);
            const firstSeen = seen.get(key);
            if (firstSeen !== undefined) {
                results.push({ rowNumber: item.rowNumber, firstSeenRow: firstSeen });
            } else {
                seen.set(key, item.rowNumber);
            }
        }
        return results;
    }

    const selects = items.map((_, idx) =>
        idx === 0
            ? 'SELECT ? AS row_num, CAST(? AS CHAR(100)) COLLATE utf8mb4_unicode_ci AS sku'
            : 'SELECT ?, ?'
    ).join(' UNION ALL ');

    const params: (number | string)[] = [];
    for (const item of items) {
        params.push(item.rowNumber, item.codigo);
    }

    const sql = `
        WITH lote AS (
            ${selects}
        )
        SELECT b.row_num AS rowNumber, MIN(a.row_num) AS firstSeenRow
        FROM lote b
        JOIN lote a ON a.sku = b.sku COLLATE utf8mb4_unicode_ci AND a.row_num < b.row_num
        GROUP BY b.row_num
        ORDER BY b.row_num ASC
    `;

    const rows = await dataSource.query(sql, params);
    return rows.map((r: any) => ({
        rowNumber: Number(r.rowNumber),
        firstSeenRow: Number(r.firstSeenRow)
    }));
};

export const findExistingSkuRows = async (
    items: Array<{ rowNumber: number; codigo: string }>
): Promise<Set<number>> => {
    if (items.length === 0) {
        return new Set<number>();
    }

    if (!dataSource.isInitialized) {
        const candidateCodes = items.map((i) => i.codigo);
        const existingCodesSet = await findExistingSkus(candidateCodes);
        const matchedRows = new Set<number>();
        for (const item of items) {
            for (const existingCode of existingCodesSet) {
                if (normalizeSkuForComparison(existingCode) === normalizeSkuForComparison(item.codigo)) {
                    matchedRows.add(item.rowNumber);
                    break;
                }
            }
        }
        return matchedRows;
    }

    if (items.length === 1) {
        const sql = `
            SELECT ? AS rowNumber
            FROM PRODUCTO p
            WHERE p.codigo = ?
            LIMIT 1
        `;
        const rows = await dataSource.query(sql, [items[0].rowNumber, items[0].codigo]);
        return new Set(rows.map((r: any) => Number(r.rowNumber)));
    }

    const selects = items.map((_, idx) =>
        idx === 0
            ? 'SELECT ? AS row_num, CAST(? AS CHAR(100)) COLLATE utf8mb4_unicode_ci AS sku'
            : 'SELECT ?, ?'
    ).join(' UNION ALL ');

    const params: (number | string)[] = [];
    for (const item of items) {
        params.push(item.rowNumber, item.codigo);
    }

    const sql = `
        WITH lote AS (
            ${selects}
        )
        SELECT DISTINCT lote.row_num AS rowNumber
        FROM lote
        JOIN PRODUCTO p ON p.codigo = lote.sku
    `;

    const rows = await dataSource.query(sql, params);
    return new Set(rows.map((r: any) => Number(r.rowNumber)));
};

export const findExistingSkus = async (skus: string[]): Promise<Set<string>> => {
    const uniqueSkus = Array.from(
        new Set(skus.map((sku) => sku.trim()).filter((sku) => sku.length > 0))
    );

    if (uniqueSkus.length === 0 || !dataSource.isInitialized) {
        return new Set<string>();
    }

    const rows = await dataSource
        .getRepository(ProductoSchema)
        .createQueryBuilder('p')
        .select('p.codigo', 'codigo')
        .where('p.codigo IN (:...skus)', { skus: uniqueSkus })
        .getRawMany<{ codigo: string }>();

    return new Set(rows.map((row) => String(row.codigo)));
};

export const findExistingCategoryIds = async (categoryIds: number[]): Promise<Set<number>> => {
    const uniqueIds = Array.from(
        new Set(categoryIds.filter((id) => Number.isInteger(id) && id > 0))
    );

    if (uniqueIds.length === 0) {
        return new Set<number>();
    }

    if (!dataSource.isInitialized) {
        return new Set(uniqueIds);
    }

    const rows = await dataSource
        .getRepository(CategoriaSchema)
        .createQueryBuilder('c')
        .select('c.id_categoria', 'id_categoria')
        .where('c.id_categoria IN (:...ids) AND c.activo = 1', { ids: uniqueIds })
        .getRawMany<{ id_categoria: number }>();

    return new Set(rows.map((row) => Number(row.id_categoria)));
};

const mockInsertedProducts = new Map<string, any>();

export const insertImportedProduct = async (row: {
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    precio: number;
    stock: number;
    id_categoria: number;
    imagen?: string | null;
    activo?: boolean;
}): Promise<InsertProductRowResult> => {
    const skuKey = normalizeSkuForComparison(row.codigo);

    if (!dataSource.isInitialized) {
        if (mockInsertedProducts.has(skuKey)) {
            return {
                success: false,
                codigo: row.codigo,
                nombre: row.nombre,
                error: `El código SKU "${row.codigo}" ya existe en la base de datos.`,
                isDuplicateConflict: true
            };
        }
        const fakeId = mockInsertedProducts.size + 1;
        mockInsertedProducts.set(skuKey, { ...row, id_producto: fakeId });
        return {
            success: true,
            id_producto: fakeId,
            codigo: row.codigo,
            nombre: row.nombre
        };
    }

    try {
        const insertResult = await inTransaction(async (manager) =>
            manager.getRepository(ProductoSchema).insert({
                codigo: row.codigo.trim(),
                nombre: row.nombre.trim(),
                descripcion: row.descripcion ? row.descripcion.trim() : null,
                precio: String(row.precio),
                stock: row.stock,
                id_categoria: row.id_categoria,
                imagen: row.imagen ? row.imagen.trim() : null,
                activo: row.activo === undefined ? 1 : Number(row.activo)
            })
        );

        const generatedId = insertResult.identifiers[0]?.id_producto;
        return {
            success: true,
            id_producto: typeof generatedId === 'number' ? generatedId : undefined,
            codigo: row.codigo,
            nombre: row.nombre
        };
    } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY' || error?.message?.includes('ER_DUP_ENTRY')) {
            return {
                success: false,
                codigo: row.codigo,
                nombre: row.nombre,
                error: `Conflicto concurrente: el código SKU "${row.codigo}" ya fue insertado por otra operación.`,
                isDuplicateConflict: true
            };
        }
        return {
            success: false,
            codigo: row.codigo,
            nombre: row.nombre,
            error: error?.message || 'Error al persistir fila de producto.'
        };
    }
};

export const clearMockInsertedProducts = (): void => {
    mockInsertedProducts.clear();
};