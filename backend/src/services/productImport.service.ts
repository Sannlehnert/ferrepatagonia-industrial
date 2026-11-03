import path from 'node:path';
import { ProductImportRowDto, RowFieldError, buildProductImportDto, validateProductImportDto } from '../dtos/products/productImport.dto';
import { findExistingCategoryIds, findExistingSkus, normalizeSkuForComparison } from '../repositories/productImport.repository';
import { FileImportValidationError, ParsedSheetRow } from '../utils/import.utils';
import { parseCsvBuffer } from '../utils/csvParser.util';
import { parseXlsxBuffer } from '../utils/xlsxParser.util';

export { FileImportValidationError };

export interface FileValidationReport {
    valid: boolean;
    totalRows: number;
    validRowsCount: number;
    invalidRowsCount: number;
    duplicateInFileCount: number;
    existingInDbCount: number;
    errors: RowFieldError[];
    validRows: ProductImportRowDto[];
}

export const validateProductImportFile = async (
    fileBuffer: Buffer,
    originalName: string
): Promise<FileValidationReport> => {
    const ext = path.extname(originalName || '').toLowerCase();

    let parsedRows: ParsedSheetRow[];
    if (ext === '.csv') {
        parsedRows = parseCsvBuffer(fileBuffer);
    } else if (ext === '.xlsx') {
        parsedRows = parseXlsxBuffer(fileBuffer);
    } else {
        throw new FileImportValidationError(
            'Extensión de archivo no soportada. Use únicamente .csv o .xlsx.'
        );
    }

    const errors: RowFieldError[] = [];
    const candidateDtos: { rowNumber: number; dto: ProductImportRowDto }[] = [];
    const seenSkusInFile = new Map<string, number>();
    let duplicateInFileCount = 0;

    for (const item of parsedRows) {
        const dto = buildProductImportDto(item.raw);
        const dtoErrors = await validateProductImportDto(dto, item.rowNumber);
        errors.push(...dtoErrors);

        if (typeof dto.codigo === 'string' && dto.codigo.length > 0 && dto.codigo.length <= 100) {
            const normalizedSku = normalizeSkuForComparison(dto.codigo);
            const firstSeenRow = seenSkusInFile.get(normalizedSku);
            if (firstSeenRow !== undefined) {
                duplicateInFileCount++;
                errors.push({
                    row: item.rowNumber,
                    field: 'codigo',
                    message: `El código SKU "${dto.codigo}" está repetido dentro del archivo (aparece primero en la fila ${firstSeenRow}).`
                });
            } else {
                seenSkusInFile.set(normalizedSku, item.rowNumber);
            }
        }

        candidateDtos.push({ rowNumber: item.rowNumber, dto });
    }

    const allCandidateSkus = candidateDtos
        .map((c) => c.dto.codigo)
        .filter((sku): sku is string => typeof sku === 'string' && sku.length > 0 && sku.length <= 100);

    const allCandidateCategoryIds = candidateDtos
        .map((c) => c.dto.id_categoria)
        .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2147483647);

    const [rawExistingSkusSet, existingCategoryIdsSet] = await Promise.all([
        findExistingSkus(allCandidateSkus),
        findExistingCategoryIds(allCandidateCategoryIds)
    ]);

    const existingSkusSet = new Set(
        Array.from(rawExistingSkusSet, (sku) => normalizeSkuForComparison(String(sku)))
    );

    let existingInDbCount = 0;

    for (const { rowNumber, dto } of candidateDtos) {
        if (typeof dto.codigo === 'string' && dto.codigo.length > 0 && dto.codigo.length <= 100) {
            if (existingSkusSet.has(normalizeSkuForComparison(dto.codigo))) {
                existingInDbCount++;
                errors.push({
                    row: rowNumber,
                    field: 'codigo',
                    message: `El código SKU "${dto.codigo}" ya existe en la base de datos.`
                });
            }
        }

        if (
            typeof dto.id_categoria === 'number' &&
            Number.isInteger(dto.id_categoria) &&
            dto.id_categoria > 0 &&
            dto.id_categoria <= 2147483647
        ) {
            if (!existingCategoryIdsSet.has(dto.id_categoria)) {
                errors.push({
                    row: rowNumber,
                    field: 'id_categoria',
                    message: `La categoría con ID ${dto.id_categoria} no existe o no se encuentra activa en la base de datos.`
                });
            }
        }
    }

    errors.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.field.localeCompare(b.field)));

    const rowsWithErrors = new Set(errors.map((e) => e.row));
    const validRows = candidateDtos
        .filter((c) => !rowsWithErrors.has(c.rowNumber))
        .map((c) => c.dto);

    return {
        valid: errors.length === 0,
        totalRows: parsedRows.length,
        validRowsCount: validRows.length,
        invalidRowsCount: rowsWithErrors.size,
        duplicateInFileCount,
        existingInDbCount,
        errors,
        validRows
    };
};