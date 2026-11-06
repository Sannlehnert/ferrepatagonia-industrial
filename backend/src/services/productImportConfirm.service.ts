import {
    findExistingCategoryIds,
    findExistingProductsBySkus,
    findExistingSkuRows,
    insertImportedProductsBatch,
    normalizeSkuForComparison
} from '../repositories/productImport.repository';
import {
    ConfirmationTokenRecord,
    PreviewBatchRowEntry,
    clearTokenActiveExecution,
    isTokenActivelyExecuting,
    markTokenActiveExecution,
    recordImportedProductLink,
    releaseSkuLocks,
    saveConfirmationRecord,
    setConfirmationTokenStatus,
    tryAcquireSkuLocks
} from '../utils/importConfirmationState.util';
import { FileImportValidationError } from '../utils/import.utils';
import {
    ConfirmImportItemDetail,
    ImportConfirmationReport,
    buildReportFromRecord,
    verifyTokenAccessAndTtl
} from './productImportReconcile.util.service';

export { ConfirmImportItemDetail, ImportConfirmationReport };

export interface ConfirmImportPayload {
    previewToken?: string;
    politicaInvalidos?: 'omitir' | 'rechazar_todo';
    [key: string]: unknown;
}

export const reconcileUncertainRowsWithDb = async (
    record: ConfirmationTokenRecord
): Promise<boolean> => {
    if (record.status !== 'por_verificar' && record.status !== 'procesando') {
        return (record.status as string) === 'completado';
    }

    const pendingEntries = record.rows.filter((r) => r.estado === 'pendiente');
    if (pendingEntries.length === 0) {
        record.status = 'completado';
        saveConfirmationRecord(record);
        return true;
    }

    try {
        const skusToVerify = pendingEntries.map((r) => r.codigo);
        const foundProductsMap = await findExistingProductsBySkus(skusToVerify);

        for (const entry of pendingEntries) {
            const normSku = normalizeSkuForComparison(entry.codigo);
            const foundId = foundProductsMap.get(normSku);

            if (foundId !== undefined) {
                const linkedId = record.batchLinkedProducts.get(normSku);
                const wasInsertedByThisBatch =
                    (linkedId !== undefined && linkedId === foundId) ||
                    record.importedProductIds.has(foundId);

                if (wasInsertedByThisBatch) {
                    entry.estado = 'importado';
                    entry.id_producto = foundId;
                    entry.motivos = [];
                    record.importedProductIds.add(foundId);
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
            } else {
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
    } catch {
        // En caso de caída transitoria de red se mantiene por_verificar
    }

    return false;
};

export const getImportConfirmationStatus = async (
    previewToken: string,
    adminId?: number | string | null
): Promise<ImportConfirmationReport> => {
    const cleanToken = typeof previewToken === 'string' ? previewToken.trim() : '';
    if (!cleanToken) {
        throw new FileImportValidationError('El parámetro previewToken es obligatorio.', 400);
    }

    const record = verifyTokenAccessAndTtl(cleanToken, adminId);
    const isInterrupted = record.status === 'procesando' && !isTokenActivelyExecuting(cleanToken);

    if (record.status === 'por_verificar' || isInterrupted) {
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
    const isInterrupted = tokenRecord.status === 'procesando' && !isTokenActivelyExecuting(token);

    if (tokenRecord.status === 'completado') {
        return buildReportFromRecord(tokenRecord);
    }

    if (tokenRecord.status === 'por_verificar' || isInterrupted) {
        const isCompleted = await reconcileUncertainRowsWithDb(tokenRecord);
        if (isCompleted) {
            return buildReportFromRecord(tokenRecord);
        }
        if (isInterrupted && !isCompleted) {
            tokenRecord.status = 'por_verificar';
            saveConfirmationRecord(tokenRecord);
            return buildReportFromRecord(tokenRecord);
        }
    }

    if (tokenRecord.status === 'procesando') {
        return buildReportFromRecord(tokenRecord);
    }

    const eligibleEntries: PreviewBatchRowEntry[] = tokenRecord.rows.filter(
        (r: PreviewBatchRowEntry): boolean => r.estado === 'pendiente'
    );
    if (eligibleEntries.length === 0) {
        throw new FileImportValidationError(
            'El lote previsualizado no contiene filas elegibles para importar.',
            400
        );
    }

    const candidateSkus: string[] = eligibleEntries.map(
        (e: PreviewBatchRowEntry): string => e.codigo
    );
    if (!tryAcquireSkuLocks(candidateSkus)) {
        throw new FileImportValidationError(
            'Conflicto transitorio: existen operaciones concurrentes sobre los mismos códigos SKU. Reintente en unos instantes.',
            409
        );
    }

    setConfirmationTokenStatus(token, 'procesando');
    markTokenActiveExecution(token);

    try {
        const skuChecks = eligibleEntries.map((e: PreviewBatchRowEntry) => ({
            rowNumber: e.row,
            codigo: e.codigo
        }));
        const categoryIds: number[] = eligibleEntries.map(
            (e: PreviewBatchRowEntry): number => e.dto.id_categoria
        );

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

        const rowsToInsert: Array<{ entry: PreviewBatchRowEntry }> = [];

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

            const { outcomes, uncertainRowNumbers } = await insertImportedProductsBatch(
                batchInputs,
                token
            );

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

                if (outcome.isCategoryInactive) {
                    entry.estado = 'rechazado';
                    entry.motivos = [
                        {
                            field: 'id_categoria',
                            code: 'CATEGORY_NOT_FOUND',
                            message: outcome.error || 'La categoría fue desactivada antes de la escritura.'
                        }
                    ];
                } else if (outcome.isDuplicateConflict) {
                    entry.estado = 'omitido';
                    entry.motivos = [
                        {
                            field: 'codigo',
                            code: 'SKU_EXISTS',
                            message: 'El SKU ya existe en el catálogo'
                        }
                    ];
                } else if (outcome.success && outcome.id_producto) {
                    entry.estado = 'importado';
                    entry.id_producto = outcome.id_producto;
                    entry.motivos = [];
                    recordImportedProductLink(token, outcome.id_producto);
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

        const hasPendingUncertain = tokenRecord.rows.some(
            (r: PreviewBatchRowEntry): boolean => r.estado === 'pendiente'
        );
        setConfirmationTokenStatus(token, hasPendingUncertain ? 'por_verificar' : 'completado');
        saveConfirmationRecord(tokenRecord);

        return buildReportFromRecord(tokenRecord);
    } finally {
        clearTokenActiveExecution(token);
        releaseSkuLocks(candidateSkus);
    }
};