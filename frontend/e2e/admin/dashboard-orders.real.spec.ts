import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { expect, test } from '@playwright/test'

interface Connection {
  query<T>(sql: string, params?: unknown[]): Promise<T>
  end(): Promise<void>
}
const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<{ connection: Connection }>
}
const { seedAdminPreviewOrders, seedAdminPreviewReceipts, marker } = require('../../../backend/test/helpers/admin-preview-orders.cjs') as {
  seedAdminPreviewOrders(profile: unknown): Promise<number>
  seedAdminPreviewReceipts(profile: unknown, directory: string): Promise<number>
  marker: string
}
const realTest = test.extend<{ db: Connection; receiptDir: string }>({
  receiptDir: async ({}, use) => {
    const root = mkdtempSync(join(tmpdir(), 'ferre-receipts-e2e-'))
    try { await use(root) } finally {
      if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Directorio temporal fuera del destino esperado')
      rmSync(root, { recursive: true, force: true })
    }
  },
  db: async ({}, use) => {
    if (!process.env.CCE2E_TEST_PROFILE) throw new Error('Usar backend/test/helpers/run-e2e.cjs')
    const { connection } = await connectOwned(JSON.parse(process.env.CCE2E_TEST_PROFILE), 'E2E')
    try { await use(connection) } finally { await connection.end() }
  },
})

async function checkDashboardMetrics(page: import('@playwright/test').Page) {
  const response = await page.request.get('/api/admin/dashboard/metricas')
  expect(response.ok()).toBe(true)
  const data = (await response.json()).data
  for (const [label, key] of [
    ['Pedidos nuevos', 'pedidosNuevos'], ['Pedidos con cuenta corriente', 'pedidosCuentaCorriente'],
    ['Comprobantes recibidos', 'comprobantesTotales'], ['Comprobantes sin evaluar', 'comprobantesSinRevisar'],
    ['Alertas de stock', 'alertasStockBajo'], ['Empresas fieles', 'empresasFieles'],
  ]) await expect(page.getByLabel(label!, { exact: true })).toHaveText(String(data.indicadores[key!]))
  const distribution = page.getByRole('region', { name: 'Pedidos por estado', exact: true })
  await expect(distribution.getByRole('definition')).toHaveCount(4)
  for (const [index, key] of ['CONFIRMADO', 'EN_PREPARACION', 'ENVIADO', 'ENTREGADO'].entries()) {
    await expect(distribution.getByRole('definition').nth(index)).toHaveText(String(data.pedidosPorEstado[key]))
  }
  await expect(distribution).toContainText(data.pedidosPorEstado.totalOperativos + ' pedidos operativos')
}

realTest('vista previa ADMIN: 24 pedidos con artículos, cards y paginación, exclusivamente en base descartable', async ({ page, db, receiptDir, baseURL }) => {
  const profile = JSON.parse(process.env.CCE2E_TEST_PROFILE!)
  await expect(seedAdminPreviewOrders({ ...profile, database: 'ferrepatagonia_dev' })).rejects.toThrow()
  const [before] = await db.query<{ total: number }[]>('SELECT COUNT(*) AS total FROM PEDIDO')
  const [paymentsBefore] = await db.query<{ total: number }[]>('SELECT COUNT(*) AS total FROM PAGO')
  const [movementsBefore] = await db.query<{ total: number }[]>('SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE')
  expect(await seedAdminPreviewOrders(profile)).toBe(24)
  expect(await seedAdminPreviewOrders(profile)).toBe(24)
  expect(await seedAdminPreviewReceipts(profile, receiptDir)).toBe(16)
  expect(await seedAdminPreviewReceipts(profile, receiptDir)).toBe(16)
  expect(readdirSync(receiptDir)).toHaveLength(16)
  const [after] = await db.query<{ total: number }[]>('SELECT COUNT(*) AS total FROM PEDIDO')
  expect(Number(after!.total)).toBe(Number(before!.total) + 24)
  const groups = await db.query<{ estado: string; total: number }[]>(
    'SELECT estado, COUNT(*) AS total FROM PEDIDO WHERE observaciones = ? GROUP BY estado', [marker],
  )
  expect(groups.map(group => Number(group.total))).toEqual([6, 6, 6, 6])
  const [lines] = await db.query<{ total: number }[]>(
    'SELECT COUNT(*) AS total FROM DETALLE_PEDIDO d JOIN PEDIDO p ON p.id_pedido = d.id_pedido WHERE p.observaciones = ?', [marker],
  )
  expect(Number(lines!.total)).toBe(48)
  expect(await db.query('SELECT COUNT(*) AS total FROM PAGO')).toEqual([paymentsBefore])
  expect(await db.query('SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE')).toEqual([movementsBefore])

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  const allGroups = await db.query<{ estado: string; total: number }[]>('SELECT estado, COUNT(*) AS total FROM PEDIDO GROUP BY estado')
  const confirmed = allGroups.find(group => group.estado === 'CONFIRMADO')?.total ?? 0
  await expect(page.getByLabel('Pedidos nuevos', { exact: true })).toHaveText(String(confirmed))
  await checkDashboardMetrics(page)
  const confirmedColor = await page.getByText('Confirmado', { exact: true }).first().evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor)
  const sentColor = await page.getByText('Enviado', { exact: true }).first().evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor)
  expect(confirmedColor).not.toBe(sentColor)
  const preview = await db.query<{ id_pedido: number; id_cliente: number }[]>(
    'SELECT id_pedido, id_cliente FROM PEDIDO WHERE observaciones = ? ORDER BY id_pedido LIMIT 3', [marker],
  )
  const wrongOwner = randomUUID()
  expect(Number(preview[0]!.id_cliente)).not.toBe(1)
  await db.query(`INSERT INTO COMPROBANTE_PAGO
    (id_comprobante, id_cliente, id_usuario_carga, id_pedido, tipo_mime, bytes, sha256, fecha_utc)
    VALUES (?, 1, 2, ?, 'application/pdf', 100, UNHEX(SHA2(?, 256)), UTC_TIMESTAMP(3))`,
    [wrongOwner, preview[0]!.id_pedido, wrongOwner])
  for (let index = 0; index < preview.length; index++) {
    const expected = index === 0 ? { total: 0, pendientesRevision: 0 }
      : { total: 1, pendientesRevision: index === 1 ? 1 : 0 }
    const id = preview[index]!.id_pedido
    const detail = await page.request.get(`/api/admin/pedidos/${id}`, { headers: { Origin: baseURL! } })
    expect(detail.ok()).toBe(true)
    expect((await detail.json()).data.comprobantes).toEqual(expected)
    const list = await page.request.get(`/api/admin/pedidos?q=${id}`, { headers: { Origin: baseURL! } })
    expect(list.ok()).toBe(true)
    expect((await list.json()).data.items.find((item: { idPedido: number }) => item.idPedido === Number(id)).comprobantes).toEqual(expected)
  }
  const receipts = await page.request.get('/api/admin/comprobantes', { headers: { Origin: baseURL! } })
  expect(receipts.ok()).toBe(true)
  expect((await receipts.json()).data.items.some((item: { id: string }) => item.id === wrongOwner)).toBe(false)
  await page.getByRole('link', { name: 'Pedidos', exact: true }).click()
  const pagination = page.getByRole('navigation', { name: 'Paginación de pedidos', exact: true })
  await expect(pagination.getByRole('button', { name: 'Siguiente', exact: true })).toBeEnabled()
  await pagination.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(pagination.locator('[aria-current="page"]')).toHaveText('2')
  await page.getByRole('button', { name: /^Ver detalle del pedido / }).first().click()
  await expect(page.getByRole('dialog').getByText('Artículos', { exact: true })).toBeVisible()
})

realTest('dashboard y filtros corresponden a los registros reales de la API y MariaDB', async ({ page, db }) => {
  const company = `Dashboard 348 ${randomUUID()}`
  const client = await db.query<{ insertId: bigint }>(`
    INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, estado_aprobacion_empresa, es_fiel, activo)
    VALUES ('EMPRESA', ?, 'APROBADA', 0, 1)
  `, [company])
  const created = await db.query<{ insertId: bigint }>(`
    INSERT INTO PEDIDO (id_cliente, fecha_utc, estado, modalidad_pago, moneda_total, subtotal, descuento, total)
    VALUES (?, UTC_TIMESTAMP(3), 'CONFIRMADO', 'TRANSFERENCIA', 'USD', 13.37, 0, 13.37)
  `, [client.insertId])
  const id = Number(created.insertId)
  const [count] = await db.query<{ total: number }[]>(
    'SELECT COUNT(*) AS total FROM PEDIDO p INNER JOIN CLIENTE c ON c.id_cliente = p.id_cliente',
  )

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  const summaryResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/admin/pedidos' && url.searchParams.get('limit') === '5'
  })
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  const response = await summaryResponse
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.data.pagination.total).toBe(Number(count!.total))
  await expect(page.getByLabel('Pedidos nuevos', { exact: true })).toBeVisible()
  await checkDashboardMetrics(page)
  for (const item of body.data.items) {
    await expect(page.getByRole('link', { name: `Ver pedido #${item.idPedido}`, exact: true })).toBeVisible()
  }

  await page.getByRole('link', { name: 'Pedidos', exact: true }).click()
  await page.getByLabel('Buscar pedidos por empresa, ID o CUIT').fill(company)
  await page.getByLabel('Filtrar por estado del pedido').selectOption('CONFIRMADO')
  await page.getByLabel('Filtrar por modalidad de pago').selectOption('TRANSFERENCIA')
  const filteredResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/admin/pedidos' && url.searchParams.get('q') === company
  })
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
  const filtered = await filteredResponse
  expect(filtered.ok()).toBe(true)
  const data = (await filtered.json()).data
  expect(data.items.map((item: { idPedido: number }) => item.idPedido)).toEqual([id])
  expect(data.pagination.total).toBe(1)
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: `Ver detalle del pedido ${id}`, exact: true }) })
  await expect(row).toContainText('USD 13.37')
  await expect(row).toContainText('Confirmado')
  await expect(row).toContainText('Transferencia bancaria')
  await page.getByRole('button', { name: `Ver detalle del pedido ${id}`, exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(company)
  await expect(page.getByRole('dialog')).toContainText('USD 13.37')
})

realTest('una respuesta de métricas de la sesión anterior no reaparece al volver a ingresar', async ({ page }) => {
  const login = async () => {
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
    await expect(page.getByLabel('Pedidos nuevos', { exact: true })).not.toContainText('—')
  }
  await login()
  let started!: () => void, release!: () => void
  const pending = new Promise<void>(resolve => { started = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/admin/dashboard/metricas', async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.data.indicadores.pedidosNuevos = 987654
    started()
    await held
    await route.fulfill({ json: body }).catch(() => {})
  }, { times: 1 })
  try {
    await page.getByRole('button', { name: 'Actualizar pedidos', exact: true }).click()
    await pending
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
  } finally { release() }
  await login()
  await expect(page.getByText('987654', { exact: true })).toHaveCount(0)
  await checkDashboardMetrics(page)
})
