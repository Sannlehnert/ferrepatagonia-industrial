import {
    findExistingCategoryIds,
    findExistingSkuRows,
    insertImportedProductsBatch,
    normalizeSkuForComparison
} from '../repositories/productImport.repository';
import {
    releaseSkuLocks,
    setConfirmationTokenStatus,
    tryAcquireSkuLocks
} from '../utils/importConfirmationState.util';
import { FileImportValidationError } from '../utils/import.utils';
import {
    ConfirmImportItemDetail,
    ImportConfirmationReport,
    buildReportFromRecord,
    reconcileUncertainRowsWithDb,
    verifyTokenAccessAndTtl
} from './productImportReconcile.util.service';

export { ConfirmImportItemDetail, ImportConfirmationReport };

export interface ConfirmImportPayload {
    previewToken?: string;
    politicaInvalidos?: 'omitir' | 'rechazar_todo';
    [key: string]: unknown;
}

export const getImportConfirmationStatus = async (
    previewToken: string,
    adminId?: number | string | null
): Promise<ImportConfirmationReport> => {
    const cleanToken = typeof previewToken === 'string' ? previewToken.trim() : '';
    if (!cleanToken) {
        throw new FileImportValidationError('El parámetro previewToken es obligatorio.', 400);
    }

    const record = verifyTokenAccessAndTtl(cleanToken, adminId);
    if (record.status === 'por_verificar') {
        await reconcileUncertainRowsWithDb(record);
    }

    return buildReportFromRecord(record);
};

export const confirmProductImport = async (
    payload: ConfirmImportPayload,
    adminId?: number | string | null
): Promise<ImportConfirmationReport> => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new FileImportValidationError(
            'El cuerpo de la solicitud debe ser un objeto JSON con { "previewToken": "string" }.',
            400
        );
    }

    const forbiddenRowKeys = ['items', 'filas', 'productos', 'validRows', 'rows', 'data'];
    for (const key of forbiddenRowKeys) {
        if (key in payload && payload[key] !== undefined) {
            throw new FileImportValidationError(
                'No se permite enviar ni sustituir filas en el cuerpo de la confirmación. Envíe únicamente { "previewToken" }.',
                400
            );
        }
    }

    const allowedKeys = new Set(['previewToken', 'politicaInvalidos']);
    for (const key of Object.keys(payload)) {
        if (!allowedKeys.has(key)) {
            throw new FileImportValidationError(
                `Propiedad no permitida en el cuerpo de confirmación: "${key}". Envíe únicamente { "previewToken" }.`,
                400
            );
        }
    }

    const token = typeof payload.previewToken === 'string' ? payload.previewToken.trim() : '';
    if (!token) {
        throw new FileImportValidationError(
            'El campo "previewToken" es obligatorio para confirmar la importación.',
            400
        );
    }

    if (payload.politicaInvalidos !== undefined && payload.politicaInvalidos !== 'omitir') {
        throw new FileImportValidationError(
            `La política "${String(payload.politicaInvalidos)}" rechaza el lote o no está permitida en la confirmación.`,
            400
        );
    }

    const tokenRecord = verifyTokenAccessAndTtl(token, adminId);

    if (tokenRecord.status === 'completado' || tokenRecord.status === 'procesando') {
        return buildReportFromRecord(tokenRecord);
    }

    if (tokenRecord.status === 'por_verificar') {
        const isCompleted = await reconcileUncertainRowsWithDb(tokenRecord);
        if (isCompleted) {
            return buildReportFromRecord(tokenRecord);
        }
    }

    const eligibleEntries = tokenRecord.rows.filter((r) => r.estado === 'pendiente');
    if (eligibleEntries.length === 0) {
        throw new FileImportValidationError(
            'El lote previsualizado no contiene filas elegibles para importar.',
            400
        );
    }

    const candidateSkus = eligibleEntries.map((e) => e.codigo);
    if (!tryAcquireSkuLocks(candidateSkus)) {
        throw new FileImportValidationError(
            'Conflicto transitorio: existen operaciones concurrentes sobre los mismos códigos SKU. Reintente en unos instantes.',
            409
        );
    }

    setConfirmationTokenStatus(token, 'procesando');

    try {
        const skuChecks = eligibleEntries.map((e) => ({ rowNumber: e.row, codigo: e.codigo }));
        const categoryIds = eligibleEntries.map((e) => e.dto.id_categoria);

        let existingSkuRows: Set<number>;
        let existingCategories: Set<number>;

        try {
            [existingSkuRows, existingCategories] = await Promise.all([
                findExistingSkuRows(skuChecks),
                findExistingCategoryIds(categoryIds)
            ]);
        } catch {
            for (const entry of eligibleEntries) {
                entry.motivos = [
                    {
                        field: 'codigo',
                        code: 'COMMIT_UNCERTAIN',
                        message: 'Estado de escritura pendiente de verificación con la base de datos.'
                    }
                ];
            }
            setConfirmationTokenStatus(token, 'por_verificar');
            return buildReportFromRecord(tokenRecord);
        }

        const rowsToInsert: Array<{ entry: (typeof eligibleEntries)[number] }> = [];

        for (const entry of eligibleEntries) {
            if (existingSkuRows.has(entry.row)) {
                entry.estado = 'omitido';
                entry.motivos = [
                    {
                        field: 'codigo',
                        code: 'SKU_EXISTS',
                        message: 'El SKU ya existe en el catálogo'
                    }
                ];
                continue;
            }

            if (!existingCategories.has(entry.dto.id_categoria)) {
                entry.estado = 'rechazado';
                entry.motivos = [
                    {
                        field: 'id_categoria',
                        code: 'CATEGORY_NOT_FOUND',
                        message: `La categoría con ID ${entry.dto.id_categoria} no existe o no se encuentra activa.`
                    }
                ];
                continue;
            }

            tokenRecord.attemptedSkus.add(normalizeSkuForComparison(entry.codigo));
            rowsToInsert.push({ entry });
        }

        if (rowsToInsert.length > 0) {
            const batchInputs = rowsToInsert.map(({ entry }) => ({
                rowNumber: entry.row,
                codigo: entry.dto.codigo,
                nombre: entry.dto.nombre,
                descripcion: entry.dto.descripcion,
                precio_base_usd: entry.dto.precio_base_usd,
                descuento_especial_pct: entry.dto.descuento_especial_pct,
                stock: entry.dto.stock,
                id_categoria: entry.dto.id_categoria,
                imagen: entry.dto.imagen,
                activo: entry.dto.activo
            }));

            const { outcomes, uncertainRowNumbers } = await insertImportedProductsBatch(batchInputs);

            for (const { entry } of rowsToInsert) {
                if (uncertainRowNumbers.has(entry.row)) {
                    entry.estado = 'pendiente';
                    entry.motivos = [
                        {
                            field: 'codigo',
                            code: 'COMMIT_UNCERTAIN',
                            message: 'La confirmación del commit es incierta; pendiente de conciliación con MariaDB.'
                        }
                    ];
                    continue;
                }

                const outcome = outcomes.get(entry.row);
                if (!outcome) continue;

                if (outcome.isUncertainCommit) {
                    entry.estado = 'pendiente';
                    entry.motivos = [
                        {
                            field: 'codigo',
                            code: 'COMMIT_UNCERTAIN',
                            message: 'La confirmación del commit es incierta; pendiente de conciliación con MariaDB.'
                        }
                    ];
                } else if (outcome.success) {
                    entry.estado = 'importado';
                    entry.id_producto = outcome.id_producto;
                    entry.motivos = [];
                } else if (outcome.isDuplicateConflict) {
                    entry.estado = 'omitido';
                    entry.motivos = [
                        {
                            field: 'codigo',
                            code: 'SKU_EXISTS',
                            message: 'El SKU ya existe en el catálogo'
                        }
                    ];
                } else {
                    entry.estado = 'pendiente';
                    entry.motivos = [
                        {
                            field: 'codigo',
                            code: 'COMMIT_UNCERTAIN',
                            message: outcome.error || 'Resultado de escritura por verificar.'
                        }
                    ];
                }
            }
        }

        const hasPendingUncertain = tokenRecord.rows.some((r) => r.estado === 'pendiente');
        setConfirmationTokenStatus(token, hasPendingUncertain ? 'por_verificar' : 'completado');

        return buildReportFromRecord(tokenRecord);
    } finally {
        releaseSkuLocks(candidateSkus);
    }
};