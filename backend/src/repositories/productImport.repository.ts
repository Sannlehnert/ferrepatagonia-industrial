declare const exports: any;

import { dataSource } from '../config/database.config';
import { CategoriaSchema, ProductoSchema } from '../entities/active.schemas';
import { normalizeSkuKey } from '../utils/importConfirmationState.util';

export interface DuplicateSkuResult {
    rowNumber: number;
    firstSeenRow: number;
}

export type SkuToProductIdMap = Map<string, number>;

export const normalizeSkuForComparison = normalizeSkuKey;

export const mockInsertedProducts = new Map<string, any>();

export const clearMockInsertedProducts = (): void => {
    mockInsertedProducts.clear();
};

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

    const selects = items
        .map((_, idx) =>
            idx === 0
                ? 'SELECT ? AS row_num, CAST(? AS CHAR(100)) COLLATE utf8mb4_unicode_ci AS sku'
                : 'SELECT ?, ?'
        )
        .join(' UNION ALL ');

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

export const findExistingSkus = async (skus: string[]): Promise<Set<string>> => {
    const uniqueSkus = Array.from(
        new Set(skus.map((sku: string) => sku.trim()).filter((sku: string) => sku.length > 0))
    );

    if (uniqueSkus.length === 0) {
        return new Set<string>();
    }

    if (!dataSource.isInitialized) {
        const result = new Set<string>();
        for (const sku of uniqueSkus) {
            const norm = normalizeSkuForComparison(sku);
            const mocked = mockInsertedProducts.get(norm);
            if (mocked) {
                result.add(mocked.codigo);
            }
        }
        return result;
    }

    const rows = await dataSource
        .getRepository(ProductoSchema)
        .createQueryBuilder('p')
        .select('p.codigo', 'codigo')
        .where('p.codigo IN (:...skus)', { skus: uniqueSkus })
        .getRawMany<{ codigo: string }>();

    return new Set(rows.map((row) => String(row.codigo)));
};

export const findExistingSkuRows = async (
    items: Array<{ rowNumber: number; codigo: string }>
): Promise<Set<number>> => {
    if (items.length === 0) {
        return new Set<number>();
    }

    if (!dataSource.isInitialized) {
        const candidateCodes = items.map((i) => i.codigo);
        const targetFinder = exports.findExistingSkus || findExistingSkus;
        const existingCodesSet: Set<string> = await targetFinder(candidateCodes);
        const matchedRows = new Set<number>();
        for (const item of items) {
            const itemNorm = normalizeSkuForComparison(item.codigo);
            for (const existingCode of existingCodesSet) {
                if (normalizeSkuForComparison(existingCode) === itemNorm) {
                    matchedRows.add(item.rowNumber);
                    break;
                }
            }
        }
        return matchedRows;
    }

    if (items.length === 1) {
        const sql = 'SELECT ? AS rowNumber FROM PRODUCTO p WHERE p.codigo = ? LIMIT 1';
        const rows = await dataSource.query(sql, [items[0].rowNumber, items[0].codigo]);
        return new Set(rows.map((r: any) => Number(r.rowNumber)));
    }

    const selects = items
        .map((_, idx) =>
            idx === 0
                ? 'SELECT ? AS row_num, CAST(? AS CHAR(100)) COLLATE utf8mb4_unicode_ci AS sku'
                : 'SELECT ?, ?'
        )
        .join(' UNION ALL ');

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

export const findExistingProductsBySkus = async (
    skus: string[]
): Promise<SkuToProductIdMap> => {
    const uniqueSkus = Array.from(
        new Set(skus.map((sku: string) => sku.trim()).filter((sku: string) => sku.length > 0))
    );
    const resultMap: SkuToProductIdMap = new Map();

    if (uniqueSkus.length === 0) {
        return resultMap;
    }

    if (!dataSource.isInitialized) {
        for (const sku of uniqueSkus) {
            const norm = normalizeSkuForComparison(sku);
            const mocked = mockInsertedProducts.get(norm);
            if (mocked && typeof mocked.id_producto === 'number') {
                resultMap.set(norm, mocked.id_producto);
            }
        }
        return resultMap;
    }

    const placeholders = uniqueSkus.map(() => '?').join(', ');
    const rows = await dataSource.query(
        `SELECT id_producto, codigo FROM PRODUCTO WHERE codigo IN (${placeholders})`,
        uniqueSkus
    );

    for (const row of rows) {
        if (row && row.codigo !== undefined && row.id_producto !== undefined) {
            resultMap.set(normalizeSkuForComparison(String(row.codigo)), Number(row.id_producto));
        }
    }

    return resultMap;
};

export const findExistingCategoryIds = async (categoryIds: number[]): Promise<Set<number>> => {
    const uniqueIds = Array.from(
        new Set(categoryIds.filter((id) => Number.isInteger(id) && id > 0))
    );

    if (uniqueIds.length === 0) {
        return new Set<number>();
    }

    if (!dataSource.isInitialized) {
        return new Set<number>(uniqueIds);
    }

    const rows = await dataSource
        .getRepository(CategoriaSchema)
        .createQueryBuilder('c')
        .select('c.id_categoria', 'id_categoria')
        .where('c.id_categoria IN (:...ids) AND c.activo = 1', { ids: uniqueIds })
        .getRawMany<{ id_categoria: number }>();

    return new Set(rows.map((row) => Number(row.id_categoria)));
};

export interface InsertProductRowInput {
    rowNumber?: number;
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    precio_base_usd?: number | null;
    precio?: number | null;
    descuento_especial_pct?: number | null;
    stock: number;
    id_categoria: number;
    imagen?: string | null;
    activo?: boolean;
}

export interface InsertProductRowResult {
    success: boolean;
    id_producto?: number;
    codigo: string;
    nombre: string;
    error?: string;
    isDuplicateConflict?: boolean;
    isUncertainCommit?: boolean;
}

const resolveExactDecimalOrNull = (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
    return null;
};

const isDuplicateEntryError = (error: any): boolean =>
    Boolean(
        error?.code === 'ER_DUP_ENTRY' ||
        error?.errno === 1062 ||
        (typeof error?.message === 'string' && error.message.includes('ER_DUP_ENTRY'))
    );

export const insertImportedProductsBatch = async (
    rows: InsertProductRowInput[]
): Promise<{
    outcomes: Map<number, InsertProductRowResult>;
    uncertainRowNumbers: Set<number>;
}> => {
    const outcomes = new Map<number, InsertProductRowResult>();
    const uncertainRowNumbers = new Set<number>();

    if (rows.length === 0) {
        return { outcomes, uncertainRowNumbers };
    }

    if (!dataSource.isInitialized) {
        const singleInserter = exports.insertImportedProduct || insertImportedProduct;
        for (let idx = 0; idx < rows.length; idx++) {
            const row = rows[idx];
            const rowNumber = row.rowNumber ?? idx + 1;
            const singleOutcome = await singleInserter(row);
            if (singleOutcome.isUncertainCommit) {
                uncertainRowNumbers.add(rowNumber);
            } else {
                outcomes.set(rowNumber, singleOutcome);
            }
        }
        return { outcomes, uncertainRowNumbers };
    }

    const provisionalOutcomes = new Map<number, InsertProductRowResult>();

    try {
        await dataSource.transaction(async (manager) => {
            for (let idx = 0; idx < rows.length; idx++) {
                const row = rows[idx];
                const rowNumber = row.rowNumber ?? idx + 1;
                const rawPrice = row.precio_base_usd !== undefined ? row.precio_base_usd : row.precio;
                const exactPrice = resolveExactDecimalOrNull(rawPrice);
                const exactDiscount = resolveExactDecimalOrNull(row.descuento_especial_pct);

                try {
                    const insertResult = await manager.query(
                        `INSERT INTO PRODUCTO (
                            codigo, nombre, descripcion, precio, descuento_especial_pct,
                            stock, id_categoria, imagen, activo
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            row.codigo.trim(),
                            row.nombre.trim(),
                            row.descripcion ? row.descripcion.trim() : null,
                            exactPrice,
                            exactDiscount,
                            row.stock,
                            row.id_categoria,
                            row.imagen ? row.imagen.trim() : null,
                            row.activo === undefined ? 1 : Number(Boolean(row.activo))
                        ]
                    );

                    const generatedId =
                        insertResult?.insertId !== undefined
                            ? Number(insertResult.insertId)
                            : insertResult?.identifiers?.[0]?.id_producto;

                    provisionalOutcomes.set(rowNumber, {
                        success: true,
                        id_producto: typeof generatedId === 'number' && generatedId > 0 ? generatedId : undefined,
                        codigo: row.codigo,
                        nombre: row.nombre
                    });
                } catch (rowError: any) {
                    if (isDuplicateEntryError(rowError)) {
                        provisionalOutcomes.set(rowNumber, {
                            success: false,
                            codigo: row.codigo,
                            nombre: row.nombre,
                            error: 'El SKU ya existe en el catálogo',
                            isDuplicateConflict: true
                        });
                    } else {
                        throw rowError;
                    }
                }
            }
        });

        for (const [rowNum, outcome] of provisionalOutcomes.entries()) {
            outcomes.set(rowNum, outcome);
        }
    } catch (_txOrCommitError: any) {
        for (let idx = 0; idx < rows.length; idx++) {
            const row = rows[idx];
            const rowNumber = row.rowNumber ?? idx + 1;
            const prev = provisionalOutcomes.get(rowNumber);
            if (prev?.isDuplicateConflict) {
                outcomes.set(rowNumber, prev);
            } else {
                uncertainRowNumbers.add(rowNumber);
            }
        }
    }

    return { outcomes, uncertainRowNumbers };
};

export const insertImportedProduct = async (
    row: InsertProductRowInput
): Promise<InsertProductRowResult> => {
    const skuKey = normalizeSkuForComparison(row.codigo);
    const rawPrice = row.precio_base_usd !== undefined ? row.precio_base_usd : row.precio;
    const exactPrice = resolveExactDecimalOrNull(rawPrice);
    const exactDiscount = resolveExactDecimalOrNull(row.descuento_especial_pct);

    if (!dataSource.isInitialized) {
        if (mockInsertedProducts.has(skuKey)) {
            return {
                success: false,
                codigo: row.codigo,
                nombre: row.nombre,
                error: 'El SKU ya existe en el catálogo',
                isDuplicateConflict: true
            };
        }
        const fakeId = mockInsertedProducts.size + 1;
        mockInsertedProducts.set(skuKey, {
            ...row,
            precio: exactPrice,
            descuento_especial_pct: exactDiscount,
            id_producto: fakeId
        });
        return {
            success: true,
            id_producto: fakeId,
            codigo: row.codigo,
            nombre: row.nombre
        };
    }

    const batchInserter = exports.insertImportedProductsBatch || insertImportedProductsBatch;
    const batchResult = await batchInserter([{ ...row, rowNumber: 1 }]);
    if (batchResult.uncertainRowNumbers.has(1)) {
        return {
            success: false,
            codigo: row.codigo,
            nombre: row.nombre,
            error: 'Resultado de escritura por verificar en la base de datos.',
            isUncertainCommit: true
        };
    }
    return (
        batchResult.outcomes.get(1) ?? {
            success: false,
            codigo: row.codigo,
            nombre: row.nombre,
            error: 'Resultado de escritura por verificar en la base de datos.',
            isUncertainCommit: true
        }
    );
};