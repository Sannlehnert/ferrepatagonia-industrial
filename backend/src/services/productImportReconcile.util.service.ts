import { RowFieldIssue } from '../dtos/products/productImport.dto';
import {
    findExistingProductsBySkus,
    normalizeSkuForComparison
} from '../repositories/productImport.repository';
import {
    ConfirmationTokenRecord,
    ImportBatchGlobalState,
    ImportBatchRowState,
    getConfirmationTokenRecordRaw,
    isConfirmationTokenExpired
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

    if (isConfirmationTokenExpired(record)) {
        throw new FileImportValidationError(
            'El token de previsualización ha vencido (TTL de 30 minutos superado). Genere una nueva previsualización.',
            410
        );
    }

    return record;
};

export const reconcileUncertainRowsWithDb = async (
    record: ConfirmationTokenRecord
): Promise<boolean> => {
    if (record.status !== 'por_verificar') {
        return (record.status as string) === 'completado';
    }

    const pendingEntries = record.rows.filter((r) => r.estado === 'pendiente');
    if (pendingEntries.length === 0) {
        record.status = 'completado';
        return true;
    }

    try {
        const skusToVerify = pendingEntries.map((r) => r.codigo);
        const foundProductsMap = await findExistingProductsBySkus(skusToVerify);

        for (const entry of pendingEntries) {
            const normSku = normalizeSkuForComparison(entry.codigo);
            const foundId = foundProductsMap.get(normSku);
            if (foundId !== undefined) {
                if (record.attemptedSkus.has(normSku)) {
                    entry.estado = 'importado';
                    entry.id_producto = foundId;
                    entry.motivos = [];
                } else {
                    entry.estado = 'omitido';
                    entry.motivos = [
                        {
                            field: 'codigo',
                            code: 'SKU_EXISTS',
                            message: 'El SKU ya existe en el catálogo'
                        }
                    ];
                }
            }
        }

        const stillPending = record.rows.some((r) => r.estado === 'pendiente');
        if (!stillPending) {
            record.status = 'completado';
            return true;
        }
    } catch {
        // En error de red se mantiene por_verificar
    }

    return false;
};