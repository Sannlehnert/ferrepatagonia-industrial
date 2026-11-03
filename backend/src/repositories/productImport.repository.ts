import { dataSource } from '../config/database.config';
import { CategoriaSchema, ProductoSchema } from '../entities/active.schemas';

export const normalizeSkuForComparison = (sku: string): string => {
    return sku.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/gi, 'SS').replace(/æ/gi, 'AE').replace(/œ/gi, 'OE').toUpperCase();
};

export const findExistingSkus = async (skus: string[]): Promise<Set<string>> => {
    const uniqueSkus = Array.from(
        new Set(skus.map((sku) => sku.trim()).filter((sku) => sku.length > 0))
    );

    if (uniqueSkus.length === 0) {
        return new Set<string>();
    }

    const rows = await dataSource
        .getRepository(ProductoSchema)
        .createQueryBuilder('p')
        .select('p.codigo', 'codigo')
        .where('p.codigo IN (:...skus)', { skus: uniqueSkus })
        .getRawMany<{ codigo: string }>();

    return new Set(rows.map((row) => normalizeSkuForComparison(String(row.codigo).trim())));
};

export const findExistingCategoryIds = async (categoryIds: number[]): Promise<Set<number>> => {
    const uniqueIds = Array.from(
        new Set(categoryIds.filter((id) => Number.isInteger(id) && id > 0))
    );

    if (uniqueIds.length === 0) {
        return new Set<number>();
    }

    const rows = await dataSource
        .getRepository(CategoriaSchema)
        .createQueryBuilder('c')
        .select('c.id_categoria', 'id_categoria')
        .where('c.id_categoria IN (:...ids)', { ids: uniqueIds })
        .getRawMany<{ id_categoria: number }>();

    return new Set(rows.map((row) => Number(row.id_categoria)));
};