import path from 'node:path';
import zlib from 'node:zlib';
import Papa from 'papaparse';
import {ProductImportRowDto,RawImportRow,RowFieldError,buildProductImportDto,validateProductImportDto} from '../dtos/products/productImport.dto';
import {findExistingCategoryIds,findExistingSkus} from '../repositories/productImport.repository';

export class FileImportValidationError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_COLUMNS = 20;
const MAX_XLSX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB anti Zip-Bomb
const MAX_XLSX_ENTRIES = 100;

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

const normalizeHeaderName = (header: unknown): string => {
    return String(header ?? '')
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase();
};

const validateHeaders = (rawHeaders: string[]): string[] => {
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

const isRowCompletelyEmpty = (raw: RawImportRow): boolean => {
    return Object.values(raw).every(
        (val) => val === undefined || val === null || String(val).trim() === ''
    );
};

const parseCsvBuffer = (buffer: Buffer): ParsedSheetRow[] => {
    const csvText = buffer.toString('utf8');
    if (csvText.trim().length === 0) {
        throw new FileImportValidationError('El archivo CSV está vacío.');
    }

    const parsed = Papa.parse<string[]>(csvText, {
        header: false,
        skipEmptyLines: false
    });

    const fatalQuoteError = parsed.errors.find(
        (err) => err.type === 'Quotes' || err.code === 'MissingQuotes' || err.code === 'InvalidQuotes'
    );
    if (fatalQuoteError) {
        throw new FileImportValidationError(
            `Archivo CSV malformado en la línea ${(fatalQuoteError.row ?? 0) + 1}: ${fatalQuoteError.message}`
        );
    }

    const rows = parsed.data;
    if (!rows || rows.length === 0) {
        throw new FileImportValidationError('El archivo CSV no contiene datos.');
    }

    const headers = validateHeaders(rows[0]);
    const dataRows: ParsedSheetRow[] = [];

    for (let i = 1; i < rows.length; i++) {
        const currentRow = rows[i];
        if (!currentRow || currentRow.every((cell) => String(cell ?? '').trim() === '')) {
            continue;
        }

        if (currentRow.length > headers.length) {
            throw new FileImportValidationError(
                `La fila ${i + 1} tiene más columnas (${currentRow.length}) que el encabezado (${headers.length}).`
            );
        }

        const raw: Record<string, unknown> = {};
        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
            raw[headers[colIdx]] = currentRow[colIdx] ?? '';
        }

        if (!isRowCompletelyEmpty(raw)) {
            dataRows.push({
                rowNumber: i + 1,
                raw
            });
        }

        if (dataRows.length > MAX_IMPORT_ROWS) {
            throw new FileImportValidationError(
                `El archivo supera el límite máximo permitido de ${MAX_IMPORT_ROWS} filas de productos.`
            );
        }
    }

    if (dataRows.length === 0) {
        throw new FileImportValidationError('El archivo no contiene filas de productos para validar.');
    }

    return dataRows;
};

const decodeXmlEntities = (text: string): string => {
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
};

const extractZipXmlEntries = (buffer: Buffer): Map<string, string> => {
    let eocdOffset = -1;
    const minEocdSearch = Math.max(0, buffer.length - 65557);
    for (let i = buffer.length - 22; i >= minEocdSearch; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }

    if (eocdOffset === -1) {
        throw new FileImportValidationError('El archivo Excel (.xlsx) está malformado o corrupto.');
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

    if (totalEntries === 0 || totalEntries > MAX_XLSX_ENTRIES || centralDirOffset >= buffer.length) {
        throw new FileImportValidationError('Estructura interna del archivo Excel (.xlsx) inválida.');
    }

    const entries = new Map<string, string>();
    let offset = centralDirOffset;
    let totalUncompressedBytes = 0;

    for (let i = 0; i < totalEntries; i++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new FileImportValidationError('El archivo Excel (.xlsx) está malformado o corrupto.');
        }

        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLen = buffer.readUInt16LE(offset + 28);
        const extraLen = buffer.readUInt16LE(offset + 30);
        const commentLen = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);

        if (offset + 46 + fileNameLen > buffer.length) {
            throw new FileImportValidationError('El archivo Excel (.xlsx) está truncado.');
        }

        const rawEntryName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLen);
        const entryName = rawEntryName.replace(/\\/g, '/');
        offset += 46 + fileNameLen + extraLen + commentLen;

        const isRelevantXml =
            entryName === 'xl/sharedStrings.xml' ||
            /^xl\/worksheets\/sheet\d+\.xml$/i.test(entryName);

        if (!isRelevantXml) {
            continue;
        }

        totalUncompressedBytes += uncompressedSize;
        if (totalUncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES) {
            throw new FileImportValidationError(
                'El archivo Excel descomprimido excede el límite seguro de memoria.'
            );
        }

        if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            throw new FileImportValidationError('Encabezado local del archivo Excel (.xlsx) corrupto.');
        }

        const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;

        if (dataEnd > buffer.length) {
            throw new FileImportValidationError('Datos comprimidos del archivo Excel (.xlsx) incompletos.');
        }

        const slice = buffer.subarray(dataStart, dataEnd);
        let contentBuffer: Buffer;

        try {
            if (compressionMethod === 0) {
                contentBuffer = slice;
            } else if (compressionMethod === 8) {
                contentBuffer = zlib.inflateRawSync(slice, {
                    maxOutputLength: MAX_XLSX_UNCOMPRESSED_BYTES
                });
            } else {
                throw new FileImportValidationError('Método de compresión XLSX no soportado.');
            }
        } catch (err) {
            if (err instanceof FileImportValidationError) {
                throw err;
            }
            throw new FileImportValidationError(
                'Error al descomprimir el archivo Excel (.xlsx). El archivo puede estar dañado.'
            );
        }

        entries.set(entryName, contentBuffer.toString('utf8'));
    }

    return entries;
};

const parseSharedStringsXml = (xml: string | undefined): string[] => {
    if (!xml) {
        return [];
    }
    const strings: string[] = [];
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;

    while ((siMatch = siRegex.exec(xml)) !== null) {
        const siBody = siMatch[1];
        const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
        let tMatch: RegExpExecArray | null;
        let combined = '';
        while ((tMatch = tRegex.exec(siBody)) !== null) {
            combined += decodeXmlEntities(tMatch[1]);
        }
        strings.push(combined);
    }

    return strings;
};

const columnLettersToIndex = (letters: string): number => {
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
        index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
};

const parseXlsxBuffer = (buffer: Buffer): ParsedSheetRow[] => {
    const entries = extractZipXmlEntries(buffer);
    const sharedStrings = parseSharedStringsXml(entries.get('xl/sharedStrings.xml'));

    const sheetKey =
        entries.has('xl/worksheets/sheet1.xml')
            ? 'xl/worksheets/sheet1.xml'
            : Array.from(entries.keys())
                  .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
                  .sort()[0];

    const sheetXml = sheetKey ? entries.get(sheetKey) : undefined;
    if (!sheetXml) {
        throw new FileImportValidationError('El archivo Excel no contiene hojas con datos.');
    }

    const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    let rowMatch: RegExpExecArray | null;
    let headers: string[] | null = null;
    const dataRows: ParsedSheetRow[] = [];
    let sequentialRowIndex = 0;

    while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
        sequentialRowIndex++;
        const rowAttrs = rowMatch[1];
        const rowBody = rowMatch[2];
        const rAttrMatch = /\br="(\d+)"/.exec(rowAttrs);
        const rowNumber = rAttrMatch ? parseInt(rAttrMatch[1], 10) : sequentialRowIndex;

        const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cellMatch: RegExpExecArray | null;
        const rowValues: string[] = [];
        let nextColIdx = 0;

        while ((cellMatch = cellRegex.exec(rowBody)) !== null) {
            const cellAttrs = cellMatch[1];
            const cellBody = cellMatch[2] ?? '';

            const refMatch = /\br="([A-Z]+)\d+"/.exec(cellAttrs);
            const colIdx = refMatch ? columnLettersToIndex(refMatch[1]) : nextColIdx;
            nextColIdx = colIdx + 1;

            if (colIdx >= MAX_IMPORT_COLUMNS) {
                throw new FileImportValidationError(
                    `El archivo Excel excede el máximo permitido de ${MAX_IMPORT_COLUMNS} columnas.`
                );
            }

            const typeMatch = /\bt="([^"]+)"/.exec(cellAttrs);
            const cellType = typeMatch ? typeMatch[1] : 'n';

            let cellText = '';
            if (cellType === 'inlineStr') {
                const tMatch = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/.exec(cellBody);
                cellText = tMatch ? decodeXmlEntities(tMatch[1]) : '';
            } else {
                const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellBody);
                const rawV = vMatch ? decodeXmlEntities(vMatch[1]).trim() : '';

                if (cellType === 's') {
                    const idx = parseInt(rawV, 10);
                    cellText =
                        Number.isInteger(idx) && idx >= 0 && idx < sharedStrings.length
                            ? sharedStrings[idx]
                            : '';
                } else if (cellType === 'b') {
                    cellText =
                        rawV === '1' || rawV.toLowerCase() === 'true'
                            ? 'true'
                            : rawV === '0' || rawV.toLowerCase() === 'false'
                              ? 'false'
                              : rawV;
                } else {
                    cellText = rawV;
                }
            }

            while (rowValues.length <= colIdx) {
                rowValues.push('');
            }
            rowValues[colIdx] = cellText;
        }

        if (headers === null) {
            while (rowValues.length > 0 && rowValues[rowValues.length - 1].trim() === '') {
                rowValues.pop();
            }
            headers = validateHeaders(rowValues);
            continue;
        }

        if (rowValues.every((val) => val.trim() === '')) {
            continue;
        }

        for (let extraCol = headers.length; extraCol < rowValues.length; extraCol++) {
            if (rowValues[extraCol].trim() !== '') {
                throw new FileImportValidationError(
                    `La fila ${rowNumber} contiene datos fuera de las columnas definidas en el encabezado.`
                );
            }
        }

        const raw: Record<string, unknown> = {};
        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
            raw[headers[colIdx]] = rowValues[colIdx] ?? '';
        }

        if (!isRowCompletelyEmpty(raw)) {
            dataRows.push({
                rowNumber,
                raw
            });
        }

        if (dataRows.length > MAX_IMPORT_ROWS) {
            throw new FileImportValidationError(
                `El archivo supera el límite máximo permitido de ${MAX_IMPORT_ROWS} filas de productos.`
            );
        }
    }

    if (headers === null) {
        throw new FileImportValidationError('El archivo Excel no contiene fila de encabezados.');
    }

    if (dataRows.length === 0) {
        throw new FileImportValidationError('El archivo Excel no contiene filas de productos para validar.');
    }

    return dataRows;
};

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
            const normalizedSku = dto.codigo.toUpperCase();
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

    const [existingSkusSet, existingCategoryIdsSet] = await Promise.all([
        findExistingSkus(allCandidateSkus),
        findExistingCategoryIds(allCandidateCategoryIds)
    ]);

    let existingInDbCount = 0;

    for (const { rowNumber, dto } of candidateDtos) {
        if (typeof dto.codigo === 'string' && dto.codigo.length > 0 && dto.codigo.length <= 100) {
            if (existingSkusSet.has(dto.codigo.toUpperCase())) {
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
                    message: `La categoría con ID ${dto.id_categoria} no existe en la base de datos.`
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