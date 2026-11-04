import zlib from 'node:zlib';
import {
    FileImportValidationError,
    ParsedSheetRow,
    validateHeaders,
    isRowCompletelyEmpty,
    MAX_IMPORT_ROWS,
    MAX_IMPORT_COLUMNS
} from './import.utils';

const MAX_XLSX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB anti Zip-Bomb
const MAX_XLSX_ENTRIES = 100;

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
    let totalRealUncompressedBytes = 0;

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

        const remainingBudget = MAX_XLSX_UNCOMPRESSED_BYTES - totalRealUncompressedBytes;
        if (remainingBudget <= 0 || uncompressedSize > remainingBudget) {
            throw new FileImportValidationError(
                `El archivo Excel descomprimido excede el límite seguro de memoria acumulada (${MAX_XLSX_UNCOMPRESSED_BYTES} bytes).`
            );
        }

        const slice = buffer.subarray(dataStart, dataEnd);
        let contentBuffer: Buffer;

        try {
            if (compressionMethod === 0) {
                contentBuffer = slice;
            } else if (compressionMethod === 8) {
                contentBuffer = zlib.inflateRawSync(slice, {
                    maxOutputLength: remainingBudget
                });
            } else {
                throw new FileImportValidationError('Método de compresión XLSX no soportado.');
            }
        } catch (err) {
            if (err instanceof FileImportValidationError) {
                throw err;
            }
            throw new FileImportValidationError(
                'Error al descomprimir el archivo Excel (.xlsx). El archivo puede estar dañado o superar el límite.'
            );
        }

        if (contentBuffer.length !== uncompressedSize) {
            throw new FileImportValidationError(
                'El archivo Excel (.xlsx) presenta metadatos de tamaño descomprimido inconsistentes.'
            );
        }

        totalRealUncompressedBytes += contentBuffer.length;
        if (totalRealUncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES) {
            throw new FileImportValidationError(
                `El archivo Excel descomprimido excede el límite seguro de memoria acumulada (${MAX_XLSX_UNCOMPRESSED_BYTES} bytes).`
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
    const siRegex = /<(?:[a-zA-Z0-9_-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?si>/g;
    let siMatch: RegExpExecArray | null;

    while ((siMatch = siRegex.exec(xml)) !== null) {
        const siBody = siMatch[1];
        // H05: Soporte para elementos <t> o <x:t>
        const tRegex = /<(?:[a-zA-Z0-9_-]+:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?t>/g;
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
    const upper = letters.toUpperCase();
    let index = 0;
    for (let i = 0; i < upper.length; i++) {
        index = index * 26 + (upper.charCodeAt(i) - 64);
    }
    return index - 1;
};

export const parseXlsxBuffer = (buffer: Buffer): ParsedSheetRow[] => {
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

    // H05: Soporte para <row> o <x:row> (incluyendo etiquetas autocontenidas)
    const rowRegex = /<(?:[a-zA-Z0-9_-]+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?row>)/g;
    let rowMatch: RegExpExecArray | null;
    let headers: string[] | null = null;
    const dataRows: ParsedSheetRow[] = [];
    let sequentialRowIndex = 0;

    while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
        sequentialRowIndex++;
        const rowAttrs = rowMatch[1];
        const rowBody = rowMatch[2] ?? '';
        const rAttrMatch = /\b(?:[a-zA-Z0-9_-]+:)?r="(\d+)"/.exec(rowAttrs);
        const rowNumber = rAttrMatch ? parseInt(rAttrMatch[1], 10) : sequentialRowIndex;

        const cellRegex = /<(?:[a-zA-Z0-9_-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?c>)/g;
        let cellMatch: RegExpExecArray | null;
        const rowValues: string[] = [];
        let nextColIdx = 0;

        while ((cellMatch = cellRegex.exec(rowBody)) !== null) {
            const cellAttrs = cellMatch[1];
            const cellBody = cellMatch[2] ?? '';

            const refMatch = /\b(?:[a-zA-Z0-9_-]+:)?r="([A-Za-z]+)\d+"/.exec(cellAttrs);
            const colIdx = refMatch ? columnLettersToIndex(refMatch[1]) : nextColIdx;
            nextColIdx = colIdx + 1;

            if (colIdx >= MAX_IMPORT_COLUMNS) {
                throw new FileImportValidationError(
                    `El archivo Excel excede el máximo permitido de ${MAX_IMPORT_COLUMNS} columnas.`
                );
            }

            const typeMatch = /\b(?:[a-zA-Z0-9_-]+:)?t="([^"]+)"/.exec(cellAttrs);
            const cellType = typeMatch ? typeMatch[1] : 'n';

            let cellText = '';
            if (cellType === 'inlineStr') {
                const tRegex = /<(?:[a-zA-Z0-9_-]+:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?t>/g;
                let tMatch: RegExpExecArray | null;
                let combined = '';
                while ((tMatch = tRegex.exec(cellBody)) !== null) {
                    combined += decodeXmlEntities(tMatch[1]);
                }
                cellText = combined;
            } else {
                // H05: Soporte para <v> o <x:v>
                const vMatch = /<(?:[a-zA-Z0-9_-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?v>/.exec(cellBody);
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
