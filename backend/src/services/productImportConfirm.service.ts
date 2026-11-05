import {
    ProductImportRowDto,
    RawImportRow,
    buildProductImportDto,
    validateProductImportDto
} from '../dtos/products/productImport.dto';
import {
    findExistingCategoryIds,
    findExistingSkuRows,
    insertImportedProduct
} from '../repositories/productImport.repository';
import {
    getConfirmationTokenRecord,
    markConfirmationTokenCompleted,
    markConfirmationTokenProcessing,
    releaseSkuLocks,
    tryAcquireSkuLocks
} from '../utils/importConfirmationState.util';
import { FileImportValidationError } from '../utils/import.utils';

export interface ConfirmImportItemDetail {
    row?: number;
    codigo: string;
    nombre: string;
    estado: 'importado' | 'omitido' | 'rechazado';
    motivo?: string;
    id_producto?: number;
}

export interface ImportConfirmationReport {
    success: boolean;
    totalProcesados: number;
    importados: number;
    omitidos: number;
    rechazados: number;
    detalles: ConfirmImportItemDetail[];
}

export interface ConfirmImportPayload {
    previewToken?: string;
    items?: ProductImportRowDto[];
    filas?: ProductImportRowDto[];
    productos?: ProductImportRowDto[];
    validRows?: ProductImportRowDto[];
    politicaInvalidos?: 'omitir' | 'rechazar_todo';
}

export const confirmProductImport = async (
    payload: ConfirmImportPayload
): Promise<ImportConfirmationReport> => {
    if (!payload || typeof payload !== 'object') {
        throw new FileImportValidationError(
            'El cuerpo de la solicitud debe contener un listado de productos válidos para confirmar.',
            400
        );
    }

    const rawItems = payload.items || payload.productos || payload.validRows || payload.filas;
    if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        throw new FileImportValidationError(
            'El cuerpo de la solicitud debe contener un listado de productos válidos para confirmar.',
            400
        );
    }

    const token = payload.previewToken?.trim();
    if (token) {
        const tokenRecord = getConfirmationTokenRecord(token);
        if (!tokenRecord) {
            throw new FileImportValidationError(
                'El token de previsualización no es válido o ha expirado. Genere una nueva previsualización.',
                400
            );
        }
        if (tokenRecord.status === 'PROCESSING') {
            throw new FileImportValidationError(
                'El lote de importación ya se encuentra en procesamiento. Evite enviar solicitudes duplicadas.',
                409
            );
        }
        if (tokenRecord.status === 'COMPLETED') {
            throw new FileImportValidationError(
                'Este lote de importación ya fue confirmado previamente.',
                409
            );
        }
        markConfirmationTokenProcessing(token);
    }

    const candidateSkus = rawItems
        .map((item) => (typeof item?.codigo === 'string' ? item.codigo.trim() : ''))
        .filter((sku) => sku.length > 0);

    if (!tryAcquireSkuLocks(candidateSkus)) {
        throw new FileImportValidationError(
            'Existen operaciones de importación o actualización concurrentes sobre los mismos productos. Reintente en unos instantes.',
            409
        );
    }

    try {
        const detalles: ConfirmImportItemDetail[] = [];
        let importados = 0;
        let omitidos = 0;
        let rechazados = 0;

        const skuChecks: Array<{ rowNumber: number; codigo: string }> = [];
        rawItems.forEach((item, idx) => {
            if (typeof item?.codigo === 'string' && item.codigo.trim().length > 0) {
                skuChecks.push({ rowNumber: idx + 1, codigo: item.codigo.trim() });
            }
        });

        const categoryIds = rawItems
            .map((r) => Number(r?.id_categoria))
            .filter((id) => Number.isInteger(id) && id > 0);

        const [existingSkuRows, existingCategories] = await Promise.all([
            findExistingSkuRows(skuChecks),
            findExistingCategoryIds(categoryIds)
        ]);

        for (let i = 0; i < rawItems.length; i++) {
            const rowNumber = i + 1;
            const dto = buildProductImportDto(rawItems[i] as unknown as RawImportRow);
            const dtoErrors = await validateProductImportDto(dto, rowNumber);

            if (dtoErrors.length > 0) {
                rechazados++;
                detalles.push({
                    row: rowNumber,
                    codigo: dto.codigo || '',
                    nombre: dto.nombre || '',
                    estado: 'rechazado',
                    motivo: dtoErrors.map((e) => e.message).join(' ')
                });
                continue;
            }

            if (existingSkuRows.has(rowNumber)) {
                omitidos++;
                detalles.push({
                    row: rowNumber,
                    codigo: dto.codigo,
                    nombre: dto.nombre,
                    estado: 'omitido',
                    motivo: `El código SKU "${dto.codigo}" ya existe en el catálogo.`
                });
                continue;
            }

            if (!existingCategories.has(dto.id_categoria)) {
                rechazados++;
                detalles.push({
                    row: rowNumber,
                    codigo: dto.codigo,
                    nombre: dto.nombre,
                    estado: 'rechazado',
                    motivo: `La categoría ${dto.id_categoria} no existe o no se encuentra activa.`
                });
                continue;
            }

            const outcome = await insertImportedProduct(dto);
            if (outcome.success) {
                importados++;
                detalles.push({
                    row: rowNumber,
                    codigo: dto.codigo,
                    nombre: dto.nombre,
                    estado: 'importado',
                    id_producto: outcome.id_producto
                });
            } else if (outcome.isDuplicateConflict) {
                omitidos++;
                detalles.push({
                    row: rowNumber,
                    codigo: dto.codigo,
                    nombre: dto.nombre,
                    estado: 'omitido',
                    motivo: outcome.error
                });
            } else {
                rechazados++;
                detalles.push({
                    row: rowNumber,
                    codigo: dto.codigo,
                    nombre: dto.nombre,
                    estado: 'rechazado',
                    motivo: outcome.error
                });
            }
        }

        const report: ImportConfirmationReport = {
            success: importados > 0 || (omitidos > 0 && rechazados === 0),
            totalProcesados: rawItems.length,
            importados,
            omitidos,
            rechazados,
            detalles
        };

        if (token) {
            markConfirmationTokenCompleted(token, report);
        }

        return report;
    } finally {
        releaseSkuLocks(candidateSkus);
    }
};