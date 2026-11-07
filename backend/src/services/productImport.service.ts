import crypto from 'node:crypto';
import path from 'node:path';
import {
    PreviewValidRowItem,
    ProductImportRowDto,
    RowFieldError,
    buildProductImportDto,
    formatPreviewProductOutput,
    validateProductImportDto
} from '../dtos/products/productImport.dto';
import {
    PreviewBatchRowEntry,
    registerConfirmationToken
} from '../utils/importConfirmationState.util';
import { FileImportValidationError, ParsedSheetRow } from '../utils/import.utils';
import { parseCsvBuffer } from '../utils/csvParser.util';
import { parseXlsxBuffer } from '../utils/xlsxParser.util';
import { runBatchIntegrityValidation } from './productImportValidation.helper.service';

export { FileImportValidationError };
export {
    confirmProductImport,
    getImportConfirmationStatus,
    ConfirmImportItemDetail,
    ConfirmImportPayload,
    ImportConfirmationReport
} from './productImportConfirm.service';

export interface FileValidationReport {
    version: 'FER16-v2';
    previewToken: string;
    expiresAt: string;
    totalRows: number;
    validRowsCount: number;
    invalidRowsCount: number;
    duplicateInFileCount: number;
    existingInDbCount: number;
    valid: boolean;
    errors: RowFieldError[];
    validRows: PreviewValidRowItem[];
}

export const validateProductImportFile = async (
    fileBuffer: Buffer,
    originalName: string,
    adminId?: number | string | null
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

    const initialErrors: RowFieldError[] = [];
    const candidateDtos: { rowNumber: number; dto: ProductImportRowDto }[] = [];

    for (const item of parsedRows) {
        const dto = buildProductImportDto(item.raw);
        const dtoErrors = await validateProductImportDto(dto, item.rowNumber);
        initialErrors.push(...dtoErrors);
        candidateDtos.push({ rowNumber: item.rowNumber, dto });
    }

    const evaluation = await runBatchIntegrityValidation(candidateDtos, initialErrors);

    const validRows: PreviewValidRowItem[] = [];
    const batchEntries: PreviewBatchRowEntry[] = [];

    for (const { rowNumber, dto } of candidateDtos) {
        const issues = evaluation.rowIssuesMap.get(rowNumber) ?? [];
        const hasRejection = evaluation.rowHasRejectionError.has(rowNumber);
        const isExistingSku = evaluation.existingSkuRowNumbers.has(rowNumber);

        if (hasRejection) {
            batchEntries.push({
                row: rowNumber,
                codigo: typeof dto.codigo === 'string' ? dto.codigo : '',
                dto,
                estado: 'rechazado',
                motivos: issues
            });
        } else if (isExistingSku) {
            batchEntries.push({
                row: rowNumber,
                codigo: dto.codigo,
                dto,
                estado: 'omitido',
                motivos: issues
            });
        } else {
            validRows.push({
                row: rowNumber,
                producto: formatPreviewProductOutput(dto)
            });
            batchEntries.push({
                row: rowNumber,
                codigo: dto.codigo,
                dto,
                estado: 'pendiente',
                motivos: []
            });
        }
    }

    const previewToken = crypto.randomUUID();
    const record = registerConfirmationToken(previewToken, batchEntries, adminId);
    const rowsWithAnyIssue = new Set(evaluation.errors.map((e) => e.row));

    return {
        version: 'FER16-v2',
        previewToken,
        expiresAt: new Date(record.expiresAtMs).toISOString(),
        totalRows: parsedRows.length,
        validRowsCount: validRows.length,
        invalidRowsCount: rowsWithAnyIssue.size,
        duplicateInFileCount: evaluation.duplicateInFileCount,
        existingInDbCount: evaluation.existingInDbCount,
        valid: evaluation.errors.length === 0,
        errors: evaluation.errors,
        validRows
    };
};