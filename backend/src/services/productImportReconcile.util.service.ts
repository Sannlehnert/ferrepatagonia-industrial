import { RowFieldIssue } from '../dtos/products/productImport.dto';
import {
    findExistingProductsBySkus,
    normalizeSkuForComparison
} from '../repositories/productImport.repository';
import {
    ConfirmationTokenRecord,
    ImportBatchGlobalState,
    ImportBatchRowState,
    PreviewBatchRowEntry,
    getConfirmationTokenRecordRaw,
    isConfirmationTokenExpired,
    restoreConfirmationRecord,
    saveConfirmationRecord,
    snapshotConfirmationRecord
} from '../utils/importConfirmationState.util';
import { FileImportValidationError } from '../utils/import.utils';

export interface ConfirmImportItemDetail {
    row: number;
    codigo: string;
    estado: ImportBatchRowState;
    id_producto?: number;
    motivos: RowFieldIssue[];
}

export interface ImportConfirmationReport {
    version: 'FER16-v2';
    previewToken: string;
    estado: ImportBatchGlobalState;
    totalProcesados: number;
    importados: number;
    omitidos: number;
    rechazados: number;
    pendientes: number;
    detalles: ConfirmImportItemDetail[];
}

export const buildReportFromRecord = (record: ConfirmationTokenRecord): ImportConfirmationReport => {
    let importados = 0;
    let omitidos = 0;
    let rechazados = 0;
    let pendientes = 0;

    const sortedRows = [...record.rows].sort((a, b) => a.row - b.row);
    const detalles: ConfirmImportItemDetail[] = sortedRows.map((entry) => {
        if (entry.estado === 'importado') importados++;
        else if (entry.estado === 'omitido') omitidos++;
        else if (entry.estado === 'rechazado') rechazados++;
        else pendientes++;

        const detail: ConfirmImportItemDetail = {
            row: entry.row,
            codigo: entry.codigo,
            estado: entry.estado,
            motivos: entry.motivos
        };

        if (entry.estado === 'importado' && entry.id_producto !== undefined) {
            detail.id_producto = entry.id_producto;
        }

        return detail;
    });

    return {
        version: 'FER16-v2',
        previewToken: record.token,
        estado: record.status,
        totalProcesados: sortedRows.length,
        importados,
        omitidos,
        rechazados,
        pendientes,
        detalles
    };
};

export const verifyTokenAccessAndTtl = (
    token: string,
    adminId?: number | string | null
): ConfirmationTokenRecord => {
    const record = getConfirmationTokenRecordRaw(token);

    if (!record) {
        throw new FileImportValidationError(
            'El token de previsualización no existe o no pertenece al administrador autenticado.',
            404
        );
    }

    if (
        record.adminId !== null &&
        adminId !== undefined &&
        adminId !== null &&
        String(record.adminId) !== String(adminId)
    ) {
        throw new FileImportValidationError(
            'El token de previsualización no existe o no pertenece al administrador autenticado.',
            404
        );
    }

    if (record.status === 'pendiente' && isConfirmationTokenExpired(record)) {
        throw new FileImportValidationError(
            'El token de previsualización ha vencido (TTL de 30 minutos superado). Genere una nueva previsualización.',
            410
        );
    }

    return record;
};

/**
 * Removes provisional link metadata for a row that was rolled back or belongs to another batch.
 */
const clearProvisionalProductLink = (
    record: ConfirmationTokenRecord,
    entry: PreviewBatchRowEntry,
    normSku: string,
    linkedId: number | undefined
): void => {
    delete entry.id_producto;
    record.batchLinkedProducts.delete(normSku);
    if (linkedId !== undefined) {
        const stillReferenced =
            Array.from(record.batchLinkedProducts.values()).includes(linkedId) ||
            record.rows.some((r) => r !== entry && r.estado === 'importado' && r.id_producto === linkedId);
        if (!stillReferenced) {
            record.importedProductIds.delete(linkedId);
        }
    }
};

export const reconcileUncertainRowsWithDb = async (
    record: ConfirmationTokenRecord
): Promise<boolean> => {
    if (record.status !== 'por_verificar' && record.status !== 'procesando') {
        return (record.status as string) === 'completado';
    }

    const pendingEntries = record.rows.filter((r) => r.estado === 'pendiente');
    if (pendingEntries.length === 0) {
        const snapshot = snapshotConfirmationRecord(record);
        try {
            record.status = 'completado';
            saveConfirmationRecord(record);
            return true;
        } catch (error) {
            restoreConfirmationRecord(record, snapshot);
            throw error;
        }
    }

    const snapshot = snapshotConfirmationRecord(record);
    try {
        const skusToVerify = pendingEntries.map((r) => r.codigo);
        const foundProductsMap = await findExistingProductsBySkus(skusToVerify);

        for (const entry of pendingEntries) {
            const normSku = normalizeSkuForComparison(entry.codigo);
            const foundId = foundProductsMap.get(normSku);
            const linkedId = record.batchLinkedProducts.get(normSku);

            if (foundId !== undefined) {
                const wasInsertedByThisBatch =
                    linkedId !== undefined
                        ? linkedId === foundId
                        : record.importedProductIds.has(foundId);

                if (wasInsertedByThisBatch) {
                    entry.estado = 'importado';
                    entry.id_producto = foundId;
                    entry.motivos = [];
                    record.batchLinkedProducts.set(normSku, foundId);
                    record.importedProductIds.add(foundId);
                } else {
                    clearProvisionalProductLink(record, entry, normSku, linkedId);
                    entry.estado = 'omitido';
                    entry.motivos = [
                        {
                            field: 'codigo',
                            code: 'SKU_EXISTS',
                            message: 'El SKU ya existe en el catálogo'
                        }
                    ];
                }
            } else {
                clearProvisionalProductLink(record, entry, normSku, linkedId);
                entry.estado = 'omitido';
                entry.motivos = [
                    {
                        field: 'codigo',
                        code: 'COMMIT_FAILED',
                        message: 'La transacción fue revertida en MariaDB y no persistió este producto.'
                    }
                ];
            }
        }

        const stillPending = record.rows.some((r) => r.estado === 'pendiente');
        if (!stillPending) {
            record.status = 'completado';
            saveConfirmationRecord(record);
            return true;
        }
    } catch (error) {
        restoreConfirmationRecord(record, snapshot);
        if (error instanceof FileImportValidationError) {
            throw error;
        }
        // En caso de caída transitoria de red se mantiene por_verificar
    }

    return false;
};