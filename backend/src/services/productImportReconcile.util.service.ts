import { RowFieldIssue } from '../dtos/products/productImport.dto';
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

    // El vencimiento de 30 min aplica a la previsualización no confirmada.
    // Los lotes ya iniciados o completados quedan protegidos bajo retención de reportes.
    if (record.status === 'pendiente' && isConfirmationTokenExpired(record)) {
        throw new FileImportValidationError(
            'El token de previsualización ha vencido (TTL de 30 minutos superado). Genere una nueva previsualización.',
            410
        );
    }

    return record;
};