import { readSheet } from 'read-excel-file/browser'
import type {
    CategoryOption,
    ProductPayload,
} from './adminProductService'

export const PRODUCT_IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024
export const PRODUCT_IMPORT_MAX_ROWS = 1000
export const PRODUCT_IMPORT_PREVIEW_ROWS = 100
export const PRODUCT_IMPORT_REQUEST_TIMEOUT_MS = 30_000
export const PRODUCT_IMPORT_RECOVERY_KEY = 'admin-product-import:v1'

export const PRODUCT_IMPORT_HEADERS = [
    'codigo',
    'nombre',
    'id_categoria',
    'precio',
    'stock',
    'descripcion',
    'imagen',
    'activo',
] as const

export type ProductImportStatus =
    | 'ready'
    | 'invalid'
    | 'creating'
    | 'created'
    | 'rejected'
    | 'uncertain'

export interface ProductImportItem {
    line: number
    codigo: string
    nombre: string
    categoryId: string
    price: string
    stock: string
    description: string
    image: string
    active: string
    payload: ProductPayload | null
    errors: string[]
    status: ProductImportStatus
}

interface CsvRecord {
    cells: string[]
    line: number
}

export interface ProductImportRecovery {
    fileName: string
    items: ProductImportItem[]
}

interface ProductImportStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
}

const utf8Encoder = new TextEncoder()

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProductPayload(value: unknown): value is ProductPayload {
    return (
        isRecord(value) &&
        typeof value.nombre === 'string' &&
        typeof value.codigo === 'string' &&
        Number.isSafeInteger(value.id_categoria) &&
        typeof value.precio === 'number' &&
        Number.isFinite(value.precio) &&
        Number.isSafeInteger(value.stock) &&
        (typeof value.descripcion === 'string' || value.descripcion === null) &&
        (typeof value.imagen === 'string' || value.imagen === null) &&
        typeof value.activo === 'boolean'
    )
}

function isProductImportStatus(value: unknown): value is ProductImportStatus {
    return (
        value === 'ready' ||
        value === 'invalid' ||
        value === 'creating' ||
        value === 'created' ||
        value === 'rejected' ||
        value === 'uncertain'
    )
}

function isProductImportItem(value: unknown): value is ProductImportItem {
    return (
        isRecord(value) &&
        Number.isSafeInteger(value.line) &&
        typeof value.codigo === 'string' &&
        typeof value.nombre === 'string' &&
        typeof value.categoryId === 'string' &&
        typeof value.price === 'string' &&
        typeof value.stock === 'string' &&
        typeof value.description === 'string' &&
        typeof value.image === 'string' &&
        typeof value.active === 'string' &&
        (value.payload === null || isProductPayload(value.payload)) &&
        Array.isArray(value.errors) &&
        value.errors.every((error) => typeof error === 'string') &&
        isProductImportStatus(value.status)
    )
}

export function saveProductImportRecovery(
    storage: ProductImportStorage,
    recovery: ProductImportRecovery,
): void {
    storage.setItem(
        PRODUCT_IMPORT_RECOVERY_KEY,
        JSON.stringify({ version: 1, ...recovery }),
    )
}

export function readProductImportRecovery(
    storage: ProductImportStorage,
): ProductImportRecovery | null {
    const stored = storage.getItem(PRODUCT_IMPORT_RECOVERY_KEY)
    if (stored === null) return null

    let value: unknown
    try {
        value = JSON.parse(stored)
    } catch {
        throw new Error('El registro de importación guardado está dañado.')
    }

    if (
        !isRecord(value) ||
        value.version !== 1 ||
        typeof value.fileName !== 'string' ||
        !Array.isArray(value.items) ||
        !value.items.every(isProductImportItem)
    ) {
        throw new Error('El registro de importación guardado no es válido.')
    }

    return {
        fileName: value.fileName,
        items: value.items.map((item) => {
            if (item.status !== 'creating') return item
            return {
                ...item,
                status: 'uncertain',
                errors: [
                    ...item.errors,
                    'La sesión se interrumpió durante esta solicitud. Revisá el catálogo antes de reintentar.',
                ],
            }
        }),
    }
}

function parseCsv(content: string): CsvRecord[] {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim()) ?? ''
    let commas = 0
    let semicolons = 0
    let quoted = false

    for (let index = 0; index < firstLine.length; index += 1) {
        const character = firstLine[index] ?? ''
        if (character === '"') {
            if (quoted && firstLine[index + 1] === '"') {
                index += 1
            } else {
                quoted = !quoted
            }
        } else if (!quoted && character === ',') {
            commas += 1
        } else if (!quoted && character === ';') {
            semicolons += 1
        }
    }

    const delimiter = semicolons > commas ? ';' : ','
    const records: CsvRecord[] = []
    let record: string[] = []
    let field = ''
    let quotedField = false
    let afterQuote = false
    let hasContent = false
    let physicalLine = 1
    let recordLine = 1

    for (let index = 0; index < content.length; index += 1) {
        const character = content[index] ?? ''

        if (quotedField) {
            if (character === '"' && content[index + 1] === '"') {
                field += '"'
                index += 1
            } else if (character === '"') {
                quotedField = false
                afterQuote = true
            } else {
                field += character
                if (character === '\r') {
                    if (content[index + 1] === '\n') {
                        field += '\n'
                        index += 1
                    }
                    physicalLine += 1
                } else if (character === '\n') {
                    physicalLine += 1
                }
            }
            continue
        }

        if (afterQuote && character !== delimiter && character !== '\r' && character !== '\n') {
            throw new Error('El CSV contiene caracteres fuera de un campo entre comillas.')
        }

        if (character === '"' && field.length === 0 && !afterQuote) {
            quotedField = true
            hasContent = true
        } else if (character === delimiter) {
            record.push(field)
            field = ''
            afterQuote = false
            hasContent = true
        } else if (character === '\r' || character === '\n') {
            if (character === '\r' && content[index + 1] === '\n') index += 1
            record.push(field)
            if (hasContent || record.some((value) => value.length > 0)) {
                records.push({ cells: record, line: recordLine })
            }
            record = []
            field = ''
            afterQuote = false
            hasContent = false
            physicalLine += 1
            recordLine = physicalLine
        } else {
            field += character
            hasContent = hasContent || character.trim().length > 0
        }
    }

    if (quotedField) throw new Error('El CSV contiene un campo entre comillas sin cerrar.')
    if (hasContent || record.length > 0 || field.length > 0 || afterQuote) {
        record.push(field)
        records.push({ cells: record, line: recordLine })
    }

    return records
}

function parsePrice(value: string): number | null {
    const normalized = value.trim().replace(',', '.')
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null

    const price = Number(normalized)
    return Number.isFinite(price) && price <= 9999999999.99 ? price : null
}

export function parseProductImportCsv(
    content: string,
    categories: readonly CategoryOption[],
): ProductImportItem[] {
    if (utf8Encoder.encode(content).length > PRODUCT_IMPORT_MAX_FILE_SIZE) {
        throw new Error('El archivo supera el límite de 5 MB.')
    }

    let records: CsvRecord[]
    try {
        records = parseCsv(content.replace(/^\uFEFF/, ''))
    } catch (error: unknown) {
        throw new Error(
            error instanceof Error ? error.message : 'No se pudo leer el archivo CSV.',
        )
    }

    return parseProductImportRecords(records, categories)
}

export async function parseProductImportXlsx(
    file: File,
    categories: readonly CategoryOption[],
): Promise<ProductImportItem[]> {
    if (file.size > PRODUCT_IMPORT_MAX_FILE_SIZE) {
        throw new Error('El archivo supera el límite de 5 MB.')
    }

    const rows = await readSheet(file)
    const records = rows.map((row, index) => ({
        cells: row.map((cell) => {
            if (cell === null || cell === undefined) return ''
            if (cell instanceof Date) return cell.toISOString()
            return String(cell)
        }),
        line: index + 1,
    }))
    return parseProductImportRecords(records, categories)
}

function parseProductImportRecords(
    records: CsvRecord[],
    categories: readonly CategoryOption[],
): ProductImportItem[] {
    if (records.length < 2) {
        throw new Error('La planilla debe incluir encabezados y al menos una fila.')
    }

    const headerRecord = records[0]
    if (!headerRecord) throw new Error('La planilla no contiene encabezados.')
    const headers = headerRecord.cells.map((header) => header.trim().toLowerCase())
    const requiredHeaders = ['codigo', 'nombre', 'id_categoria', 'precio', 'stock']
    const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header))
    const unknownHeaders = headers.filter(
        (header) => !(PRODUCT_IMPORT_HEADERS as readonly string[]).includes(header),
    )

    if (missingHeaders.length > 0 || unknownHeaders.length > 0) {
        const details = [
            missingHeaders.length > 0
                ? `Faltan columnas obligatorias: ${missingHeaders.join(', ')}.`
                : '',
            unknownHeaders.length > 0
                ? `Columnas no reconocidas: ${unknownHeaders.join(', ')}.`
                : '',
        ]
            .filter(Boolean)
            .join(' ')
        throw new Error(details)
    }
    if (new Set(headers).size !== headers.length) {
        throw new Error('La planilla contiene encabezados duplicados.')
    }

    const columns = new Map(headers.map((header, index) => [header, index]))
    const getValue = (row: string[], name: string) =>
        row[columns.get(name) ?? -1]?.trim() ?? ''
    const categoryIds = new Set(
        categories
            .filter((category) => category.activo === undefined || Boolean(category.activo))
            .map((category) => Number(category.id_categoria)),
    )
    const dataRecords = records.slice(1)
    const nonEmptyRecords = dataRecords.filter(
        ({ cells }) => !cells.every((value) => value.trim() === ''),
    )
    if (nonEmptyRecords.length > PRODUCT_IMPORT_MAX_ROWS) {
        throw new Error(`La planilla supera el máximo de ${PRODUCT_IMPORT_MAX_ROWS} filas.`)
    }

    const items: ProductImportItem[] = []
    for (const record of dataRecords) {
        const row = record.cells
        const line = record.line
        if (row.every((value) => value.trim() === '')) continue

        const codigo = getValue(row, 'codigo')
        const nombre = getValue(row, 'nombre')
        const categoryText = getValue(row, 'id_categoria')
        const priceText = getValue(row, 'precio')
        const stockText = getValue(row, 'stock')
        const description = getValue(row, 'descripcion')
        const image = getValue(row, 'imagen')
        const activeText = getValue(row, 'activo')
        const errors: string[] = []

        if (row.length !== headers.length) {
            errors.push('La cantidad de celdas no coincide con los encabezados.')
        }
        if (!codigo) errors.push('El código SKU es obligatorio.')
        else if (codigo.length > 100) errors.push('El código SKU supera los 100 caracteres.')

        if (!nombre) errors.push('El nombre del producto es obligatorio.')
        else if (nombre.length > 200) errors.push('El nombre supera los 200 caracteres.')

        const categoryId = /^\d+$/.test(categoryText) ? Number(categoryText) : NaN
        if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
            errors.push('La categoría debe ser un ID entero mayor a 0.')
        } else if (!categoryIds.has(categoryId)) {
            errors.push('La categoría no existe o no está activa.')
        }

        const precio = parsePrice(priceText)
        if (precio === null) {
            errors.push('El precio debe ser un número entre 0 y 9999999999.99, con hasta 2 decimales.')
        }

        const stock = /^\d+$/.test(stockText) ? Number(stockText) : NaN
        if (!Number.isSafeInteger(stock) || stock < 0 || stock > 2147483647) {
            errors.push('El stock debe ser un entero entre 0 y 2147483647.')
        }

        if (utf8Encoder.encode(description).length > 65535) {
            errors.push('La descripción supera el máximo de 65535 bytes.')
        }
        if (image.length > 2048) errors.push('La URL de imagen supera los 2048 caracteres.')

        let activo = true
        if (activeText) {
            if (activeText.toLowerCase() === 'true') activo = true
            else if (activeText.toLowerCase() === 'false') activo = false
            else errors.push('El campo activo solo admite true o false.')
        }

        const payload =
            errors.length === 0 && precio !== null
                ? {
                      codigo,
                      nombre,
                      id_categoria: categoryId,
                      precio,
                      stock,
                      descripcion: description || null,
                      imagen: image || null,
                      activo,
                  }
                : null

        items.push({
            line,
            codigo,
            nombre,
            categoryId: categoryText,
            price: priceText,
            stock: stockText,
            description,
            image,
            active: activeText,
            payload,
            errors,
            status: errors.length === 0 ? 'ready' : 'invalid',
        })
    }

    if (items.length === 0) throw new Error('La planilla no contiene filas con productos.')
    return items
}

export function createProductImportTemplate(): string {
    return `${PRODUCT_IMPORT_HEADERS.join(',')}\r\n`
}

function csvCell(value: string): string {
    const sanitized = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    const safeValue = /^[\s]*[=+\-@]/u.test(sanitized) ? `'${sanitized}` : sanitized
    return `"${safeValue.replaceAll('"', '""')}"`
}

export function createProductImportErrorReport(
    items: readonly ProductImportItem[],
): string {
    const rows = items.filter(
        (item) =>
            item.status === 'invalid' ||
            item.status === 'rejected' ||
            item.status === 'uncertain',
    )
    const header = ['fila', 'codigo', 'nombre', 'estado', 'errores']
    const lines = [
        header,
        ...rows.map((item) => [
            String(item.line),
            item.codigo,
            item.nombre,
            item.status === 'invalid'
                ? 'Error de validación'
                : item.status === 'uncertain'
                  ? 'Resultado incierto'
                  : 'Rechazado por el servidor',
            item.errors.join(' '),
        ]),
    ]

    return `\uFEFF${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
