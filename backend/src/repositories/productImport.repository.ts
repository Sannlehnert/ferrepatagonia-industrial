import { dataSource } from '../config/database.config';
import { CategoriaSchema, ProductoSchema } from '../entities/active.schemas';

export const normalizeSkuForComparison = (sku: string): string => {
    return sku
        .trim()
        // Elimina caracteres invisibles/ignorables de formato (ZWJ \u200D, ZWNJ \u200C, ZWSP \u200B, BOM \uFEFF, etc.)
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '')
        // Descompone acentos y diacríticos diacríticos estándar (NFD)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // toLowerCase mantiene la distinción entre 'i' y 'ı' que toUpperCase destruye
        .toLowerCase();
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

    return new Set(rows.map((row) => normalizeSkuForComparison(String(row.codigo))));
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
        .andWhere('c.activo = 1')
        .getRawMany<{ id_categoria: number }>();

    return new Set(rows.map((row) => Number(row.id_categoria)));
};