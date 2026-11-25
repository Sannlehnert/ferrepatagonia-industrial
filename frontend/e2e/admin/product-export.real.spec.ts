import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import { withOwnedDb } from '../helpers/owned-db'

const require = createRequire(import.meta.url)
const password = 'E2eLocal-214!'
const createdIds: number[] = []

type Connection = {
  query(sql: string, params?: unknown[]): Promise<unknown>
}

async function insertProduct(
  connection: Connection,
  values: {
    codigo: string
    nombre: string
    descripcion: string | null
    precio: string | null
    descuento: string | null
    activo: number
    stock?: number
  },
): Promise<number> {
  const result = await connection.query(
    `INSERT INTO PRODUCTO
      (id_categoria, codigo, nombre, descripcion, precio, descuento_especial_pct, stock, imagen, activo)
     VALUES (1, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      values.codigo, values.nombre, values.descripcion, values.precio,
      values.descuento, values.stock ?? 5, values.activo,
    ],
  ) as { insertId: number | string }
  const id = Number(result.insertId)
  createdIds.push(id)
  return id
}

async function loginAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}

async function exportFile(page: import('@playwright/test').Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar a Excel', exact: true }).click()
  const download = await pending
  const path = test.info().outputPath('productos.xlsx')
  await download.saveAs(path)
  return { download, buffer: await readFile(path) }
}

test.beforeAll(async () => {
  await withOwnedDb(async connection => {
    await connection.query('SET @fer17_actor_id = 1')
    try {
      const existing = await connection.query('SELECT COUNT(*) AS total FROM PRODUCTO') as Array<{ total: number }>
      const current = Number(existing[0]?.total ?? 0)
      const needed = Math.max(0, 100 - current)

      const specialId = await insertProduct(connection, {
        codigo: '000354000',
        nombre: 'Producto "Especial" & Ñandú <export>',
        descripcion: 'Línea 1\nLínea 2 =SUMA(1,2)',
        precio: '123.45',
        descuento: '10.00',
        activo: 1,
      })
      await connection.query(
        `INSERT INTO PRECIO_USD_EVIDENCIA
          (id_producto, precio_verificado, evidencia, id_admin, verificado_utc, valida, sintetica)
         VALUES (?, 123.45, 'TEST-ONLY exportación #354', 1, '2020-01-01 12:00:00', 1, 0)`,
        [specialId],
      )
      await insertProduct(connection, {
        codigo: '000354001', nombre: 'Producto sin precio de exportación',
        descripcion: null, precio: null, descuento: null, activo: 1,
      })
      await insertProduct(connection, {
        codigo: '000354002', nombre: 'Producto con precio cero',
        descripcion: null, precio: '0.00', descuento: '20.00', activo: 1,
      })
      await insertProduct(connection, {
        codigo: '000354003', nombre: 'Producto inactivo de exportación',
        descripcion: null, precio: '99.90', descuento: null, activo: 0,
      })

      for (let index = 0; index < Math.max(0, needed - 4); index += 1) {
        await insertProduct(connection, {
          codigo: `000354${String(index + 10).padStart(3, '0')}`,
          nombre: `Producto exportación ${index + 1}`,
          descripcion: `Descripción de exportación ${index + 1}`,
          precio: index % 5 === 0 ? null : `10${String(index % 90).padStart(2, '0')}.50`,
          descuento: index % 3 === 0 ? '10.00' : null,
          activo: index % 2,
        })
      }
    } finally {
      await connection.query('SET @fer17_actor_id = NULL')
    }
  })
})

test.afterAll(async () => {
  if (!createdIds.length) return
  try {
    await withOwnedDb(async connection => {
      const marks = createdIds.map(() => '?').join(', ')
      await connection.query(`DELETE FROM PRECIO_USD_EVIDENCIA WHERE id_producto IN (${marks})`, createdIds)
      await connection.query(`DELETE FROM PRODUCTO WHERE id_producto IN (${marks})`, createdIds)
    })
  } catch (error) {
    console.error('No se pudo limpiar el fixture de exportación.', error)
  }
})

test('exporta todo el catálogo a XLSX válido, reimportable y respeta el filtro activo', async ({ page }) => {
  test.setTimeout(90_000)
  await loginAdmin(page)
  await page.goto('/admin/productos')
  const summary = page.getByText(/Mostrando \d+ de \d+ productos/)
  await expect(summary).toBeVisible()
  const totalText = await summary.innerText()
  const total = Number(/de (\d+) productos/.exec(totalText)?.[1] ?? 0)
  expect(total).toBeGreaterThanOrEqual(100)
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)

  const exported = await exportFile(page)
  expect(exported.download.suggestedFilename()).toMatch(/^productos-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const { parseXlsxBuffer } = require('../../../backend/dist/utils/xlsxParser.util.js')
  const rows = parseXlsxBuffer(exported.buffer) as Array<{ raw: Record<string, string> }>
  expect(rows).toHaveLength(total)
  const special = rows.find(row => row.raw.codigo === '000354000')
  expect(special?.raw).toMatchObject({
    codigo: '000354000',
    nombre: 'Producto "Especial" & Ñandú <export>',
    precio_base_usd: '123.45',
    descuento_especial_pct: '10.00',
    activo: 'true',
  })
  expect(special?.raw.descripcion).toContain('=SUMA(1,2)')
  const noPrice = rows.find(row => row.raw.codigo === '000354001')
  expect(noPrice?.raw.precio_base_usd).toBe('')
  const zero = rows.find(row => row.raw.codigo === '000354002')
  expect(zero?.raw.precio_base_usd).toBe('0.00')
  expect(zero?.raw.descuento_especial_pct).toBe('20.00')
  const inactive = rows.find(row => row.raw.codigo === '000354003')
  expect(inactive?.raw.activo).toBe('false')
  expect(new Set(rows.map(row => row.raw.codigo)).size).toBe(rows.length)

  await page.screenshot({
    path: '../docs/354/evidence/admin-products-export-1280.png',
    fullPage: true,
  })

  const files = unzipSync(exported.buffer)
  const productsXml = strFromU8(files['xl/worksheets/sheet1.xml']!)
  const pricesXml = strFromU8(files['xl/worksheets/sheet2.xml']!)
  const workbookXml = strFromU8(files['xl/workbook.xml']!)
  expect(productsXml).not.toContain('<f>')
  expect(workbookXml).toContain('name="Productos"')
  expect(workbookXml).toContain('name="Estado de precios"')
  expect(pricesXml).toContain('estado_precio')
  expect(pricesXml).toContain('VERIFICADO')
  expect(pricesXml).toContain('SIN_PRECIO')
  expect(pricesXml).toContain('Herramientas')

  // El archivo exportado usa el contrato FER16-v2 y el importador lo acepta.
  // No se confirma la importación: los SKU ya existen y deben omitirse, no duplicarse.
  const preview = await page.request.post('/api/admin/productos/importar/previsualizar', {
    headers: { Origin: new URL(page.url()).origin },
    multipart: {
      file: {
        name: 'productos-exportados.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: exported.buffer,
      },
    },
  })
  expect(preview.status(), await preview.text()).toBe(200)
  const previewBody = await preview.json() as {
    version: string
    totalRows: number
    existingInDbCount: number
  }
  expect(previewBody.version).toBe('FER16-v2')
  expect(previewBody.totalRows).toBe(rows.length)
  expect(previewBody.existingInDbCount).toBeGreaterThanOrEqual(createdIds.length)

  await page.getByLabel('Buscar productos por nombre o SKU').fill('000354000')
  await expect(page).toHaveURL(/busqueda=000354000/)
  const filtered = await exportFile(page)
  expect(filtered.download.suggestedFilename()).toMatch(/^productos-filtrados-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const filteredRows = parseXlsxBuffer(filtered.buffer) as Array<{ raw: Record<string, string> }>
  expect(filteredRows).toHaveLength(1)
  expect(filteredRows[0]?.raw.codigo).toBe('000354000')
  await page.setViewportSize({ width: 390, height: 900 })
  await page.screenshot({
    path: '../docs/354/evidence/admin-products-export-390.png',
    fullPage: true,
  })
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
})
