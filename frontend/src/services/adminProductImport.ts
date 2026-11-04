import { readSheet } from 'read-excel-file/browser'
import { unzipSync } from 'fflate'
import type {
    AdminProduct,
    CategoryOption,
    ProductPayload,
} from './adminProductService'
import { isCategoryActive } from './adminProductService'

export const PRODUCT_IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024
export const PRODUCT_IMPORT_MAX_UNCOMPRESSED_SIZE = 24 * 1024 * 1024
export const PRODUCT_IMPORT_MAX_ROWS = 1000
export const PRODUCT_IMPORT_PREVIEW_ROWS = 100
export const PRODUCT_IMPORT_REQUEST_TIMEOUT_MS = 30_000
export const PRODUCT_IMPORT_RECOVERY_KEY = 'admin-product-import:v1'
export const PRODUCT_IMPORT_TAB_ID_KEY = 'admin-product-import:tab:v1'

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
    getItem(key: string): string | null | Promise<string | null>
    setItem(key: string, value: string): void | Promise<void>
}

const utf8Encoder = new TextEncoder()
const RECOVERY_DATABASE_NAME = 'ferrepatagonia-admin-product-import'
const RECOVERY_STORE_NAME = 'recoveries'
const recoveryWriteQueues = new Map<string, Promise<void>>()

export function getProductImportTabId(
    providedStorage?: Pick<Storage, 'getItem' | 'setItem'>,
): string {
    try {
        const storage =
            providedStorage ??
            (typeof window === 'undefined' ? undefined : window.sessionStorage)
        if (!storage) {
            throw new Error('No hay almacenamiento de sesión disponible.')
        }
        const existingId = storage.getItem(PRODUCT_IMPORT_TAB_ID_KEY)
        if (existingId && /^[a-f0-9-]{36}$/i.test(existingId)) return existingId
        const tabId = globalThis.crypto.randomUUID()
        storage.setItem(PRODUCT_IMPORT_TAB_ID_KEY, tabId)
        return tabId
    } catch {
        throw new Error('No se pudo identificar la pestaña para recuperar la importación.')
    }
}

export function getProductImportRecoveryKey(userId: number, tabId: string): string {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error('No se pudo asociar la recuperación a una sesión administrativa.')
    }
    if (!/^[a-f0-9-]{36}$/i.test(tabId)) {
        throw new Error('No se pudo asociar la recuperación a esta pestaña.')
    }
    return `${PRODUCT_IMPORT_RECOVERY_KEY}:${userId}:${tabId}`
}

export function createProductImportRecoveryStorage(
    factory: IDBFactory | undefined = globalThis.indexedDB,
): ProductImportStorage {
    if (!factory) {
        throw new Error('El navegador no permite almacenar la recuperación de la importación.')
    }

    let databasePromise: Promise<IDBDatabase> | null = null
    const openDatabase = (): Promise<IDBDatabase> => {
        if (databasePromise) return databasePromise
        const opening = new Promise<IDBDatabase>((resolve, reject) => {
            const request = factory.open(RECOVERY_DATABASE_NAME, 1)
            request.onupgradeneeded = () => {
                const database = request.result
                if (!database.objectStoreNames.contains(RECOVERY_STORE_NAME)) {
                    database.createObjectStore(RECOVERY_STORE_NAME)
                }
            }
            request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento de recuperación.'))
            request.onblocked = () => reject(new Error('El almacenamiento de recuperación está bloqueado por otra pestaña.'))
            request.onsuccess = () => {
                const database = request.result
                database.onversionchange = () => database.close()
                resolve(database)
            }
        }).catch((error: unknown) => {
            databasePromise = null
            throw error
        })
        databasePromise = opening
        return opening
    }

    return {
        async getItem(key) {
            const database = await openDatabase()
            return new Promise<string | null>((resolve, reject) => {
                const transaction = database.transaction(RECOVERY_STORE_NAME, 'readonly')
                const request = transaction.objectStore(RECOVERY_STORE_NAME).get(key)
                let result: unknown
                request.onsuccess = () => {
                    result = request.result
                }
                request.onerror = () => reject(new Error('No se pudo leer la recuperación de la importación.'))
                transaction.oncomplete = () => resolve(typeof result === 'string' ? result : null)
                transaction.onerror = () => reject(new Error('No se pudo leer la recuperación de la importación.'))
                transaction.onabort = () => reject(new Error('No se pudo leer la recuperación de la importación.'))
            })
        },
        async setItem(key, value) {
            const database = await openDatabase()
            await new Promise<void>((resolve, reject) => {
                const transaction = database.transaction(RECOVERY_STORE_NAME, 'readwrite')
                transaction.objectStore(RECOVERY_STORE_NAME).put(value, key)
                transaction.oncomplete = () => resolve()
                transaction.onerror = () => reject(new Error('No se pudo guardar la recuperación de la importación.'))
                transaction.onabort = () => reject(new Error('No se pudo guardar la recuperación de la importación.'))
            })
        },
    }
}

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

export async function saveProductImportRecovery(
    storage: ProductImportStorage,
    recovery: ProductImportRecovery,
    key = PRODUCT_IMPORT_RECOVERY_KEY,
): Promise<void> {
    const previousWrite = recoveryWriteQueues.get(key) ?? Promise.resolve()
    const write = previousWrite.catch(() => undefined).then(() =>
        storage.setItem(key, JSON.stringify({ version: 1, ...recovery })),
    )
    recoveryWriteQueues.set(key, write)
    try {
        await write
    } finally {
        if (recoveryWriteQueues.get(key) === write) recoveryWriteQueues.delete(key)
    }
}

export async function readProductImportRecovery(
    storage: ProductImportStorage,
    key = PRODUCT_IMPORT_RECOVERY_KEY,
): Promise<ProductImportRecovery | null> {
    const stored = await storage.getItem(key)
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
    existingProducts: readonly Pick<AdminProduct, 'codigo'>[] = [],
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

    return parseProductImportRecords(records, categories, existingProducts)
}

export async function parseProductImportXlsx(
    file: File,
    categories: readonly CategoryOption[],
    existingProducts: readonly Pick<AdminProduct, 'codigo'>[] = [],
): Promise<ProductImportItem[]> {
    if (file.size > PRODUCT_IMPORT_MAX_FILE_SIZE) {
        throw new Error('El archivo supera el límite de 5 MB.')
    }

    const contents = await file.arrayBuffer()
    validateXlsxArchive(contents)
    const files = unzipSync(new Uint8Array(contents))
    const expandedSize = Object.values(files).reduce(
        (total, entry) => total + entry.byteLength,
        0,
    )
    if (expandedSize > PRODUCT_IMPORT_MAX_UNCOMPRESSED_SIZE) {
        throw new Error('El XLSX supera el límite de 24 MB descomprimidos.')
    }
    rejectXlsxFormulas(files)

    const rows = await readSheet(contents)
    const records = rows.map((row, index) => ({
        cells: row.map((cell) => {
            if (cell === null || cell === undefined) return ''
            if (cell instanceof Date) return cell.toISOString()
            return String(cell)
        }),
        line: index + 1,
    }))
    return parseProductImportRecords(records, categories, existingProducts)
}

function validateXlsxArchive(contents: ArrayBuffer): void {
    const bytes = new Uint8Array(contents)
    const view = new DataView(contents)
    const earliestEndRecord = Math.max(0, bytes.length - 22 - 0xffff)
    let endRecordOffset = -1

    for (let offset = bytes.length - 22; offset >= earliestEndRecord; offset -= 1) {
        if (
            view.getUint32(offset, true) === 0x06054b50 &&
            offset + 22 + view.getUint16(offset + 20, true) === bytes.length
        ) {
            endRecordOffset = offset
            break
        }
    }

    if (endRecordOffset < 0) {
        throw new Error('El archivo XLSX no contiene un directorio ZIP válido.')
    }

    let fflateEndRecordOffset = bytes.length - 22
    while (
        fflateEndRecordOffset >= earliestEndRecord &&
        view.getUint32(fflateEndRecordOffset, true) !== 0x06054b50
    ) {
        fflateEndRecordOffset -= 1
    }
    if (fflateEndRecordOffset !== endRecordOffset) {
        throw new Error('El archivo XLSX contiene directorios ZIP ambiguos.')
    }

    const diskNumber = view.getUint16(endRecordOffset + 4, true)
    const directoryDiskNumber = view.getUint16(endRecordOffset + 6, true)
    const entriesOnDisk = view.getUint16(endRecordOffset + 8, true)
    const entryCount = view.getUint16(endRecordOffset + 10, true)
    const directorySize = view.getUint32(endRecordOffset + 12, true)
    const directoryOffset = view.getUint32(endRecordOffset + 16, true)
    if (
        diskNumber !== 0 ||
        directoryDiskNumber !== 0 ||
        entriesOnDisk !== entryCount ||
        entryCount === 0xffff ||
        directorySize === 0xffffffff ||
        directoryOffset === 0xffffffff ||
        directoryOffset + directorySize > endRecordOffset
    ) {
        throw new Error('El archivo XLSX usa una estructura ZIP no compatible.')
    }
    if (entryCount > 512) {
        throw new Error('El archivo XLSX supera el máximo de 512 entradas ZIP.')
    }

    let expandedSize = 0
    let offset = directoryOffset
    for (let index = 0; index < entryCount; index += 1) {
        if (
            offset + 46 > directoryOffset + directorySize ||
            view.getUint32(offset, true) !== 0x02014b50
        ) {
            throw new Error('El archivo XLSX contiene un directorio ZIP inválido.')
        }

        const flags = view.getUint16(offset + 8, true)
        const compressedSize = view.getUint32(offset + 20, true)
        const uncompressedSize = view.getUint32(offset + 24, true)
        const nameLength = view.getUint16(offset + 28, true)
        const extraLength = view.getUint16(offset + 30, true)
        const commentLength = view.getUint16(offset + 32, true)
        const entryEnd = offset + 46 + nameLength + extraLength + commentLength

        if (
            entryEnd > directoryOffset + directorySize ||
            (flags & 1) !== 0 ||
            compressedSize === 0xffffffff ||
            uncompressedSize === 0xffffffff
        ) {
            throw new Error('El archivo XLSX contiene una entrada ZIP no compatible.')
        }

        expandedSize += uncompressedSize
        if (expandedSize > PRODUCT_IMPORT_MAX_UNCOMPRESSED_SIZE) {
            throw new Error('El XLSX supera el límite de 24 MB descomprimidos.')
        }
        offset = entryEnd
    }
    if (offset !== directoryOffset + directorySize) {
        throw new Error('El archivo XLSX contiene un directorio ZIP ambiguo.')
    }
}

function getXmlAttribute(attributes: string, name: string): string | null {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`).exec(attributes)
    return match ? decodeXmlText(match[2] ?? '') : null
}

function decodeXmlText(value: string): string {
    return value.replace(
        /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
        (entity, name: string) => {
            if (name[0] === '#') {
                const codePoint = name[1]?.toLowerCase() === 'x'
                    ? Number.parseInt(name.slice(2), 16)
                    : Number.parseInt(name.slice(1), 10)
                return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity
            }
            return {
                amp: '&',
                lt: '<',
                gt: '>',
                quot: '"',
                apos: "'",
            }[name.toLowerCase()] ?? entity
        },
    )
}

function getWorksheetPath(files: Record<string, Uint8Array>): string {
    const decoder = new TextDecoder()
    const workbook = files['xl/workbook.xml']
    const relationships = files['xl/_rels/workbook.xml.rels']
    if (!workbook || !relationships) return 'xl/worksheets/sheet1.xml'

    const sheetTag = /<(?:[\w.-]+:)?sheet\b([^>]*)\/?>/.exec(
        decoder.decode(workbook),
    )?.[1]
    const relationshipId = sheetTag
        ? getXmlAttribute(sheetTag, 'r:id')
        : null
    if (!relationshipId) return 'xl/worksheets/sheet1.xml'

    const relationshipTags = decoder.decode(relationships).matchAll(
        /<(?:[\w.-]+:)?Relationship\b([^>]*)\/?>/g,
    )
    for (const [, attributes] of relationshipTags) {
        if (getXmlAttribute(attributes ?? '', 'Id') !== relationshipId) continue
        const target = getXmlAttribute(attributes ?? '', 'Target')
        if (!target) break
        const pathParts: string[] = []
        for (const part of (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/')) {
            if (part === '..') pathParts.pop()
            else if (part !== '.' && part !== '') pathParts.push(part)
        }
        return pathParts.join('/')
    }

    return 'xl/worksheets/sheet1.xml'
}

function rejectXlsxFormulas(files: Record<string, Uint8Array>): void {
    const worksheet = files[getWorksheetPath(files)]
    if (!worksheet) return

    const decoder = new TextDecoder()
    const worksheetXml = decoder.decode(worksheet)
    const sharedStringsXml = files['xl/sharedStrings.xml']
    const sharedStrings = sharedStringsXml
        ? Array.from(decoder.decode(sharedStringsXml).matchAll(
            /<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si\s*>/g,
        ))
            .map(([, item]) =>
                Array.from(item?.matchAll(
                    /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t\s*>/g,
                ) ?? [])
                    .map(([, text]) => decodeXmlText(text ?? ''))
                    .join(''),
            )
        : []
    const headers = new Map<number, string>()
    const cells = worksheetXml.matchAll(
        /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c\s*>)/g,
    )

    for (const [, attributes = '', content = ''] of cells) {
        const reference = getXmlAttribute(attributes, 'r') ?? ''
        const coordinates = /^([A-Z]+)(\d+)$/i.exec(reference)
        if (!coordinates) continue

        const columnLetters = coordinates[1]?.toUpperCase() ?? ''
        const rowNumber = Number(coordinates[2])
        let columnNumber = 0
        for (const letter of columnLetters) {
            columnNumber = columnNumber * 26 + letter.charCodeAt(0) - 64
        }
        const columnIndex = columnNumber - 1

        if (rowNumber === 1) {
            const cellType = getXmlAttribute(attributes, 't')
            const value = /<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v\s*>/.exec(
                content,
            )?.[1]
            const inlineText = Array.from(content.matchAll(
                /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t\s*>/g,
            ))
                .map(([, text]) => decodeXmlText(text ?? ''))
                .join('')
            const header = cellType === 's' && value !== undefined
                ? sharedStrings[Number(value)] ?? ''
                : cellType === 'inlineStr'
                    ? inlineText
                    : value === undefined
                        ? ''
                        : decodeXmlText(value)
            if (header) headers.set(columnIndex, header.trim().toLowerCase())
        }

        if (/<(?:[\w.-]+:)?f\b[^>]*(?:\/>|>[\s\S]*?<\/(?:[\w.-]+:)?f\s*>)/.test(content)) {
            const columnName = headers.get(columnIndex) ?? `columna ${columnLetters}`
            throw new Error(
                `No se permiten fórmulas en la fila ${rowNumber}, campo "${columnName}".`,
            )
        }
    }
}

function parseProductImportRecords(
    records: CsvRecord[],
    categories: readonly CategoryOption[],
    existingProducts: readonly Pick<AdminProduct, 'codigo'>[] = [],
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
            .filter(isCategoryActive)
            .map((category) => Number(category.id_categoria)),
    )
    const existingSkuCodes = new Set(
        existingProducts.map((product) => product.codigo.toLowerCase()),
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
        else if (existingSkuCodes.has(codigo.toLowerCase())) {
            errors.push('El código SKU ya existe en el catálogo.')
        }

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

    const skuRows = new Map<string, ProductImportItem[]>()
    for (const item of items) {
        if (!item.codigo) continue
        const normalizedCode = item.codigo.toLowerCase()
        const rows = skuRows.get(normalizedCode) ?? []
        rows.push(item)
        skuRows.set(normalizedCode, rows)
    }
    for (const rows of skuRows.values()) {
        if (rows.length < 2) continue
        for (const item of rows) {
            item.errors.push('El código SKU está repetido dentro de la planilla.')
            item.payload = null
            item.status = 'invalid'
        }
    }

    return items
}

export function createProductImportTemplate(): string {
    return `${PRODUCT_IMPORT_HEADERS.join(',')}\r\n`
}

function csvCell(value: string): string {
    const sanitized = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    const safeValue = /^[\s]*[=+\-@]/u.test(sanitized.normalize('NFKC'))
        ? `'${sanitized}`
        : sanitized
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
