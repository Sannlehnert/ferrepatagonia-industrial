import { strToU8, zipSync } from 'fflate'
import { getAdminProductPage, type AdminProduct } from './adminProductService'

export const PRODUCT_EXPORT_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const PRODUCT_EXPORT_HEADERS = [
  'codigo',
  'nombre',
  'id_categoria',
  'precio_base_usd',
  'stock',
  'descripcion',
  'imagen',
  'activo',
  'descuento_especial_pct',
] as const

const PRICE_STATE_HEADERS = [
  'codigo',
  'nombre',
  'categoria_id',
  'categoria',
  'precio_cargado_usd',
  'precio_verificado_usd',
  'estado_precio',
  'stock',
  'activo',
] as const

export interface ProductExportResult {
  products: AdminProduct[]
  bytes: Uint8Array
  filename: string
}

export async function collectAdminProductsForExport(
  search = '',
  signal?: AbortSignal,
): Promise<AdminProduct[]> {
  const first = await getAdminProductPage(1, search, signal, 100)
  if (first.total === 0) return []
  const products = [...first.data]
  for (let page = 2; page <= first.totalPages; page += 1) {
    signal?.throwIfAborted()
    const next = await getAdminProductPage(page, search, signal, 100)
    if (next.total !== first.total || next.totalPages !== first.totalPages) {
      throw new Error('El catálogo cambió durante la exportación. Reintentá para obtener una copia consistente.')
    }
    products.push(...next.data)
  }
  signal?.throwIfAborted()
  if (products.length !== first.total ||
    new Set(products.map(product => product.id_producto)).size !== products.length) {
    throw new Error('La exportación quedó incompleta o contiene productos repetidos. Reintentá.')
  }
  return products
}

function normalizeDecimal2(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value).trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return ''
  const [whole, fraction = ''] = text.split('.')
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`
}

function booleanText(value: number | boolean | string | null | undefined): 'true' | 'false' {
  if (value === true || value === 1 || value === '1' || value === 'true') return 'true'
  return 'false'
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function columnName(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function inlineCell(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function numberCell(reference: string, value: string): string {
  return `<c r="${reference}"><v>${value}</v></c>`
}

function rowXml(rowNumber: number, cells: string[]): string {
  return `<row r="${rowNumber}">${cells.join('')}</row>`
}

function sheetXml(rows: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
}

function productRow(product: AdminProduct, rowNumber: number): string {
  const cells: string[] = []
  const addText = (column: number, value: string | null | undefined) => {
    if (value === null || value === undefined || value === '') return
    cells.push(inlineCell(`${columnName(column)}${rowNumber}`, String(value)))
  }
  const addNumber = (column: number, value: string | null | undefined) => {
    if (value === null || value === undefined || value === '') return
    cells.push(numberCell(`${columnName(column)}${rowNumber}`, value))
  }

  addText(0, product.codigo)
  addText(1, product.nombre)
  addNumber(2, String(product.id_categoria))
  addNumber(3, normalizeDecimal2(product.precio))
  addNumber(4, String(product.stock))
  addText(5, product.descripcion)
  addText(6, product.imagen)
  addText(7, booleanText(product.activo))
  addNumber(8, normalizeDecimal2(product.descuento_especial_pct))
  return rowXml(rowNumber, cells)
}

function priceStateRow(product: AdminProduct, rowNumber: number): string {
  const cells: string[] = []
  const addText = (column: number, value: string | null | undefined) => {
    if (value === null || value === undefined || value === '') return
    cells.push(inlineCell(`${columnName(column)}${rowNumber}`, String(value)))
  }
  const addNumber = (column: number, value: string | null | undefined) => {
    if (value === null || value === undefined || value === '') return
    cells.push(numberCell(`${columnName(column)}${rowNumber}`, value))
  }

  addText(0, product.codigo)
  addText(1, product.nombre)
  addNumber(2, String(product.id_categoria))
  addText(3, product.categoria_nombre)
  addNumber(4, normalizeDecimal2(product.precio))
  addNumber(5, normalizeDecimal2(product.precio_verificado))
  addText(6, product.estado_precio_base ?? 'NO_DETERMINADO')
  addNumber(7, String(product.stock))
  addText(8, booleanText(product.activo))
  return rowXml(rowNumber, cells)
}

export function buildProductsWorkbook(products: readonly AdminProduct[]): Uint8Array {
  const productsSheet = sheetXml([
    rowXml(1, PRODUCT_EXPORT_HEADERS.map((header, index) =>
      inlineCell(`${columnName(index)}1`, header))),
    ...products.map((product, index) => productRow(product, index + 2)),
  ])
  const pricesSheet = sheetXml([
    rowXml(1, PRICE_STATE_HEADERS.map((header, index) =>
      inlineCell(`${columnName(index)}1`, header))),
    ...products.map((product, index) => priceStateRow(product, index + 2)),
  ])

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="Productos" sheetId="1" r:id="rId1"/>
<sheet name="Estado de precios" sheetId="2" r:id="rId2"/>
</sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(productsSheet),
    'xl/worksheets/sheet2.xml': strToU8(pricesSheet),
  }, { level: 6 })
}

export function productsExportFilename(search = '', now = new Date()): string {
  const date = now.toISOString().slice(0, 10)
  return `${search.trim() ? 'productos-filtrados' : 'productos'}-${date}.xlsx`
}

export function downloadProductsWorkbook(bytes: Uint8Array, filename: string): void {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const blob = new Blob([buffer], { type: PRODUCT_EXPORT_MIME })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
