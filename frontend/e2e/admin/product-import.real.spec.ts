import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const importApi = '**/api/admin/productos/importar'
const headers = 'codigo,nombre,id_categoria,precio_base_usd,stock,descripcion,imagen,activo,descuento_especial_pct'

test('recupera el resultado de una importación confirmada sin duplicar productos', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8)
  const validSku = `E2E-IMPORT-${suffix}`
  const invalidSku = `E2E-INVALID-${suffix}`
  const csv = [
    headers,
    `${validSku},Producto de importación E2E,1,,5,,https://example.test/producto.png,false,`,
    `${invalidSku},Producto con stock inválido,1,0,-1,,,true,`,
  ].join('\r\n')

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await page.goto('/admin/productos/importar')

  await page.getByLabel('Archivo CSV o XLSX').setInputFiles({
    name: 'importacion-mixta.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })

  await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible()
  await expect(page.getByText(/1 listas para importar/)).toBeVisible()
  await expect(page.getByText(/Fila 3, stock/)).toBeVisible()

  let confirmationRequests = 0
  let confirmationStatus: number | undefined
  let confirmationBody: unknown

  await page.route(`${importApi}/confirmar`, async (route) => {
    confirmationRequests++
    confirmationBody = route.request().postDataJSON()

    const response = await route.fetch()
    confirmationStatus = response.status()
    await route.abort('failed')
  })

  await page.getByRole('button', { name: 'Confirmar importación', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Consultá el estado del mismo lote')
  expect(confirmationRequests).toBe(1)
  expect(confirmationStatus).toBe(200)
  expect(confirmationBody).toEqual({ previewToken: expect.any(String) })

  const { previewToken } = confirmationBody as { previewToken: string }
  const recoveredResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname.endsWith(`/confirmaciones/${previewToken}`),
  )

  await page.reload()

  const recovered = await recoveredResponse
  expect(recovered.status()).toBe(200)

  const result = await recovered.json()
  expect(result).toMatchObject({
    previewToken,
    estado: 'completado',
    totalProcesados: 2,
    importados: 1,
    omitidos: 0,
    rechazados: 1,
    pendientes: 0,
    detalles: expect.arrayContaining([
      expect.objectContaining({ codigo: validSku, estado: 'importado' }),
      expect.objectContaining({ codigo: invalidSku, estado: 'rechazado' }),
    ]),
  })

  await expect(page.getByText(/Completado.*1 importadas.*1 rechazadas/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Descargar reporte de errores' })).toBeVisible()
  expect(confirmationRequests).toBe(1)
})

test('dos confirmaciones simultáneas conservan un único resultado para el lote', async ({ page }) => {
  const sku = `E2E-DOUBLE-${randomUUID().slice(0, 8)}`
  const csv = [
    headers,
    `${sku},Producto de doble confirmación,1,0,5,,,false,`,
  ].join('\r\n')

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await page.goto('/admin/productos/importar')

  const previewResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/importar/previsualizar'),
  )

  await page.getByLabel('Archivo CSV o XLSX').setInputFiles({
    name: 'doble-confirmacion.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })

  const preview = await previewResponse
  expect(preview.status()).toBe(200)
  const { previewToken } = await preview.json()
  expect(previewToken).toEqual(expect.any(String))

  const endpoint = '/api/admin/productos/importar'
  const confirmBatch = () => page.request.post(`${endpoint}/confirmar`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { previewToken },
  })

  const responses = await Promise.all([confirmBatch(), confirmBatch()])
  for (const response of responses) {
    expect([200, 202]).toContain(response.status())
  }

  const statusUrl = `${endpoint}/confirmaciones/${encodeURIComponent(previewToken)}`
  await expect.poll(async () => {
    const response = await page.request.get(statusUrl)
    expect(response.status()).toBe(200)
    return (await response.json()).estado
  }).toBe('completado')

  const result = await (await page.request.get(statusUrl)).json()
  expect(result).toMatchObject({
    previewToken,
    estado: 'completado',
    totalProcesados: 1,
    importados: 1,
    omitidos: 0,
    rechazados: 0,
    pendientes: 0,
    detalles: [
      expect.objectContaining({
        codigo: sku,
        estado: 'importado',
        id_producto: expect.any(Number),
      }),
    ],
  })

  const replay = await confirmBatch()
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(result)
})

test('un reporte que devuelve 404 permite dejar de seguir el lote sin reconfirmar', async ({ page }) => {
  const sku = `E2E-MISSING-${randomUUID().slice(0, 8)}`
  const csv = [headers, `${sku},Producto de prueba,1,0,5,,,true,`].join('\r\n')

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await page.goto('/admin/productos/importar')

  const fileInput = page.getByLabel('Archivo CSV o XLSX')
  await fileInput.setInputFiles({
    name: 'reporte-no-disponible.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })

  let confirmationRequests = 0
  await page.route(`${importApi}/confirmar`, async (route) => {
    confirmationRequests++
    const { previewToken } = route.request().postDataJSON()

    await route.fulfill({
      status: 202,
      json: {
        version: 'FER16-v2',
        previewToken,
        estado: 'pendiente',
        totalProcesados: 1,
        importados: 0,
        omitidos: 0,
        rechazados: 0,
        pendientes: 1,
        detalles: [],
      },
    })
  })

  await page.route(`${importApi}/confirmaciones/*`, (route) =>
    route.fulfill({ status: 404, json: { message: 'Reporte no encontrado' } }),
  )

  await page.getByRole('button', { name: 'Confirmar importación', exact: true }).click()
  const retry = page.getByRole('button', { name: 'Reintentar confirmación del lote' })
  await expect(retry).toBeEnabled()

  await page.getByRole('button', { name: 'Consultar estado del lote' }).click()
  await expect(page.getByRole('alert')).toContainText('El servidor ya no encuentra el reporte')
  await expect(retry).not.toBeEnabled()
  await expect(fileInput).toBeDisabled()

  await page.getByRole('button', {
    name: 'Ya revisé el catálogo, dejar de seguir este lote',
  }).click()
  await expect(fileInput).toBeEnabled()

  await page.reload()
  await expect(fileInput).toBeEnabled()
  expect(confirmationRequests).toBe(1)
})

test('previsualiza y confirma un XLSX válido conservando el SKU con ceros', async ({ page }) => {
  const fixture = await readFile(
    new URL('../../../docs/234/ejemplos/validos.xlsx', import.meta.url),
  )
  const workbook = unzipSync(fixture)
  const sheetPath = 'xl/worksheets/sheet1.xml'
  const sheet = strFromU8(workbook[sheetPath]!)
  const activeCells = /(<x:c r="H[2-5]"[^>]*><x:v>)true(<\/x:v>)/g

  // Mantiene los productos de prueba fuera del catálogo público.
  expect([...sheet.matchAll(activeCells)]).toHaveLength(4)
  workbook[sheetPath] = strToU8(sheet.replace(activeCells, '$1false$2'))

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await page.goto('/admin/productos/importar')

  await page.getByLabel('Archivo CSV o XLSX').setInputFiles({
    name: 'validos.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(zipSync(workbook)),
  })

  await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible()
  await expect(page.getByText(/4 listas para importar/)).toBeVisible()
  await expect(page.getByRole('cell', { name: '000123', exact: true })).toBeVisible()

  const confirmation = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/importar/confirmar'),
  )

  await page.getByRole('button', { name: 'Confirmar importación', exact: true }).click()

  const response = await confirmation
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({
    estado: 'completado',
    totalProcesados: 4,
    importados: 4,
    omitidos: 0,
    rechazados: 0,
    pendientes: 0,
    detalles: expect.arrayContaining([
      expect.objectContaining({ codigo: '000123', estado: 'importado' }),
    ]),
  })
  await expect(page.getByText(/Completado.*4 importadas.*0 rechazadas/)).toBeVisible()
})