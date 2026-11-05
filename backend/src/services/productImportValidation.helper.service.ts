import {
    ProductImportRowDto,
    RowFieldError,
    RowFieldIssue
} from '../dtos/products/productImport.dto';
import {
    findExistingCategoryIds,
    findExistingSkuRows,
    findFileSkuDuplicates
} from '../repositories/productImport.repository';

export interface EvaluatedCandidateRows {
    candidateDtos: { rowNumber: number; dto: ProductImportRowDto }[];
    errors: RowFieldError[];
    rowIssuesMap: Map<number, RowFieldIssue[]>;
    rowHasRejectionError: Set<number>;
    existingSkuRowNumbers: Set<number>;
    duplicateInFileCount: number;
    existingInDbCount: number;
}

export const runBatchIntegrityValidation = async (
    candidateDtos: { rowNumber: number; dto: ProductImportRowDto }[],
    initialErrors: RowFieldError[]
): Promise<EvaluatedCandidateRows> => {
    const errors: RowFieldError[] = [...initialErrors];
    const rowIssuesMap = new Map<number, RowFieldIssue[]>();
    const rowHasRejectionError = new Set<number>();

    for (const err of initialErrors) {
        const list = rowIssuesMap.get(err.row) ?? [];
        list.push({ field: err.field, code: err.code, message: err.message });
        rowIssuesMap.set(err.row, list);
        rowHasRejectionError.add(err.row);
    }

    const candidateSkuItems: Array<{ rowNumber: number; codigo: string }> = [];
    for (const { rowNumber, dto } of candidateDtos) {
        if (typeof dto.codigo === 'string' && dto.codigo.trim().length > 0 && dto.codigo.trim().length <= 100) {
            candidateSkuItems.push({ rowNumber, codigo: dto.codigo.trim() });
        }
    }

    const allCandidateCategoryIds = candidateDtos
        .map((c) => c.dto.id_categoria)
        .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2147483647);

    const [internalDuplicates, existingSkuRowNumbers, existingCategoryIdsSet] = await Promise.all([
        findFileSkuDuplicates(candidateSkuItems),
        findExistingSkuRows(candidateSkuItems),
        findExistingCategoryIds(allCandidateCategoryIds)
    ]);

    let duplicateInFileCount = 0;
    const duplicateRowMap = new Map<number, number>();
    for (const dup of internalDuplicates) {
        duplicateRowMap.set(dup.rowNumber, dup.firstSeenRow);
    }

    const addIssue = (rowNumber: number, issue: RowFieldIssue, isRejection: boolean): void => {
        errors.push({ row: rowNumber, ...issue });
        const list = rowIssuesMap.get(rowNumber) ?? [];
        list.push(issue);
        rowIssuesMap.set(rowNumber, list);
        if (isRejection) {
            rowHasRejectionError.add(rowNumber);
        }
    };

    for (const { rowNumber, dto } of candidateDtos) {
        const firstSeenRow = duplicateRowMap.get(rowNumber);
        if (firstSeenRow !== undefined) {
            duplicateInFileCount++;
            addIssue(
                rowNumber,
                {
                    field: 'codigo',
                    code: 'DUPLICATE_SKU_IN_FILE',
                    message: `El código SKU "${dto.codigo}" está repetido dentro del archivo (aparece primero en la fila ${firstSeenRow}).`
                },
                true
            );
        }

        if (
            typeof dto.id_categoria === 'number' &&
            Number.isInteger(dto.id_categoria) &&
            dto.id_categoria > 0 &&
            dto.id_categoria <= 2147483647 &&
            !existingCategoryIdsSet.has(dto.id_categoria)
        ) {
            addIssue(
                rowNumber,
                {
                    field: 'id_categoria',
                    code: 'CATEGORY_NOT_FOUND',
                    message: `La categoría con ID ${dto.id_categoria} no existe o no se encuentra activa en la base de datos.`
                },
                true
            );
        }

        if (existingSkuRowNumbers.has(rowNumber)) {
            addIssue(
                rowNumber,
                {
                    field: 'codigo',
                    code: 'SKU_EXISTS',
                    message: 'El SKU ya existe en el catálogo'
                },
                false
            );
        }
    }

    errors.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.field.localeCompare(b.field)));

    return {
        candidateDtos,
        errors,
        rowIssuesMap,
        rowHasRejectionError,
        existingSkuRowNumbers,
        duplicateInFileCount,
        existingInDbCount: existingSkuRowNumbers.size
    };
};