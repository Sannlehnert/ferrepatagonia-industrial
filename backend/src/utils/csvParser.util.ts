import Papa from 'papaparse';
import {FileImportValidationError,ParsedSheetRow,validateHeaders,isRowCompletelyEmpty,MAX_IMPORT_ROWS} from './import.utils';

export const parseCsvBuffer = (buffer: Buffer): ParsedSheetRow[] => {
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