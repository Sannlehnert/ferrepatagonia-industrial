import { RawImportRow } from '../dtos/products/productImport.dto';

export class FileImportValidationError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_COLUMNS = 20;

const REQUIRED_HEADERS = ['codigo', 'nombre', 'id_categoria', 'precio', 'stock'] as const;
const ALLOWED_HEADERS = new Set([
    'codigo',
    'nombre',
    'id_categoria',
    'precio',
    'stock',
    'descripcion',
    'imagen',
    'activo'
]);

export interface ParsedSheetRow {
    rowNumber: number;
    raw: RawImportRow;
}

const normalizeHeaderName = (header: unknown): string => {
    return String(header ?? '')
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase();
};

export const validateHeaders = (rawHeaders: string[]): string[] => {
    if (rawHeaders.length === 0) {
        throw new FileImportValidationError('El archivo no contiene fila de encabezados.');
    }

    if (rawHeaders.length > MAX_IMPORT_COLUMNS) {
        throw new FileImportValidationError(
            `El archivo excede el máximo permitido de ${MAX_IMPORT_COLUMNS} columnas.`
        );
    }

    const normalizedHeaders = rawHeaders.map(normalizeHeaderName);
    const seenHeaders = new Set<string>();

    for (const header of normalizedHeaders) {
        if (!header) {
            throw new FileImportValidationError('El archivo contiene columnas con encabezado vacío.');
        }
        if (seenHeaders.has(header)) {
            throw new FileImportValidationError(`El encabezado "${header}" está duplicado en la plantilla.`);
        }
        if (!ALLOWED_HEADERS.has(header)) {
            throw new FileImportValidationError(`Columna no reconocida en la plantilla: "${header}".`);
        }
        seenHeaders.add(header);
    }

    for (const required of REQUIRED_HEADERS) {
        if (!seenHeaders.has(required)) {
            throw new FileImportValidationError(
                `Falta la columna obligatoria "${required}" en el encabezado del archivo.`
            );
        }
    }

    return normalizedHeaders;
};

export const isRowCompletelyEmpty = (raw: RawImportRow): boolean => {
    return Object.values(raw).every(
        (val) => val === undefined || val === null || String(val).trim() === ''
    );
};