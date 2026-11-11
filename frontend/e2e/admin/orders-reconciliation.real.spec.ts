import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

interface DisposableSession {
  connection: {
    query<T>(sql: string, params: unknown[]): Promise<T>
    end(): Promise<void>
  }
}

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<DisposableSession>
}
const ordersPath = '/api/admin/pedidos'

const ordersTest = test.extend<{ db: DisposableSession['connection'] }>({
  db: async ({}, use) => {
    const profile = process.env.CCE2E_TEST_PROFILE
    if (!profile) throw new Error('Ejecutá la prueba con backend/test/helpers/run-e2e.cjs')
    const { connection } = await connectOwned(JSON.parse(profile), 'E2E')
    try { await use(connection) }
    finally { await connection.end() }
  },
})
ordersTest.use({ timezoneId: 'Asia/Tokyo' })

async function fixture(db: DisposableSession['connection'], extraOrders = 0) {
  const company = 'Reconciliación ' + randomUUID()
  const customer = await db.query<{ insertId: bigint }>(`
    INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, estado_aprobacion_empresa, es_fiel, activo)
    VALUES ('EMPRESA', ?, 'APROBADA', 0, 1)
  `, [company])
  async function order(total: string) {
    const result = await db.query<{ insertId: bigint }>(`
      INSERT INTO PEDIDO (id_cliente, fecha_utc, estado, modalidad_pago, moneda_total, subtotal, descuento, total)
      VALUES (?, '2026-11-11 02:59:59.999', 'CONFIRMADO', 'TRANSFERENCIA', 'USD', ?, 0, ?)
    `, [customer.insertId, total, total])
    return Number(result.insertId)
  }
  const a = await order('150.00')
  const b = await order('280.00')
  for (let i = 0; i < extraOrders; i++) await order('100.00')
  return { company, a, b }
}

function persisted(db: DisposableSession['connection'], id: number) {
  return db.query<{ estado: string; total: string }[]>(
    'SELECT estado, subtotal, descuento, total, moneda_total FROM PEDIDO WHERE id_pedido = ?', [id],
  )
}

async function openPanel(page: Page, company: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await page.getByRole('link', { name: 'Pedidos', exact: true }).click()
  await page.getByLabel('Buscar pedidos por empresa, ID o CUIT').fill(company)
  await page.getByLabel('Filtrar por fecha').fill('2026-11-10')
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
}

const rowFor = (page: Page, id: number) => page.getByRole('row').filter({
  has: page.getByRole('button', { name: `Ver detalle del pedido ${id}`, exact: true }),
})
const openOrder = (page: Page, id: number) => page.getByRole('button', { name: `Ver detalle del pedido ${id}`, exact: true }).click()
const listQuery = (request: { method(): string; url(): string }) =>
  request.method() === 'GET' && new URL(request.url()).pathname === ordersPath

function gate() {
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  return { ready, release }
}

async function holdCommittedPatch(page: Page, id: number) {
  const committed = gate()
  const delivery = gate()
  const path = `${ordersPath}/${id}/estado`
  await page.route(`**${path}`, async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    committed.release()
    await delivery.ready
    await route.fulfill({ response })
  }, { times: 1 })
  return { committed: committed.ready, deliver: delivery.release, path }
}

ordersTest('un PATCH tardío actualiza por REST la página filtrada y deja intacto el pedido abierto', async ({ page, db }) => {
  const { company, a, b } = await fixture(db, 20)
  const bBefore = await persisted(db, b)
  await openPanel(page, company)
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(rowFor(page, a)).toContainText('Confirmado')
  await expect(rowFor(page, a)).toContainText('10/11/2026')
  const pending = await holdCommittedPatch(page, a)
  const dialog = page.getByRole('dialog')
  try {
    await openOrder(page, a)
    await dialog.getByRole('button', { name: 'Guardar Estado' }).click()
    await pending.committed
    expect((await persisted(db, a))[0]?.estado).toBe('EN_PREPARACION')
    await dialog.getByRole('button', { name: 'Cerrar modal' }).click()
    await openOrder(page, b)
    const save = dialog.getByRole('button', { name: 'Guardar Estado' })
    const selection = dialog.getByRole('combobox')
    await expect(save).toBeEnabled()
    await expect(selection).toHaveValue('EN_PREPARACION')
    await expect(rowFor(page, a)).toContainText('Confirmado')

    const listReads: string[] = []
    page.on('request', request => { if (listQuery(request)) listReads.push(request.url()) })
    const refreshed = page.waitForResponse(response => listQuery(response.request()))
    pending.deliver()
    const response = await refreshed
    expect(response.ok()).toBe(true)
    const params = new URL(response.url()).searchParams
    expect(Object.fromEntries(params)).toEqual({ page: '2', limit: '20', fecha: '2026-11-10', q: company })
    await expect(rowFor(page, a)).toContainText('En preparación')
    await expect(dialog.getByRole('heading', { name: `Pedido #${b}` })).toBeVisible()
    await expect(dialog.getByText('USD 280.00', { exact: true })).toBeVisible()
    await expect(selection).toHaveValue('EN_PREPARACION')
    await expect(save).toBeEnabled()
    await expect(rowFor(page, b)).toContainText('Confirmado')
    expect(await persisted(db, b)).toEqual(bBefore)
    expect(listReads).toEqual([response.url()])
  } finally { pending.deliver() }
})

ordersTest('un PATCH pendiente al cerrar sesión no repuebla el listado ni inicia otra consulta', async ({ page, db }) => {
  const { company, a } = await fixture(db)
  await openPanel(page, company)
  const pending = await holdCommittedPatch(page, a)
  try {
    await openOrder(page, a)
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar Estado' }).click()
    await pending.committed
    await page.getByRole('button', { name: 'Cerrar modal' }).click()
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)

    const unexpectedReads: string[] = []
    page.on('request', request => { if (listQuery(request)) unexpectedReads.push(request.url()) })
    const received = page.waitForResponse(response => new URL(response.url()).pathname === pending.path)
    pending.deliver()
    await (await received).finished()
    await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
    expect(unexpectedReads).toEqual([])
    await expect(page.getByText(company, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await persisted(db, a))[0]?.estado).toBe('EN_PREPARACION')
  } finally { pending.deliver() }
})

ordersTest('si la red pierde la respuesta después del commit, el listado se reconcilia sin repetir el PATCH', async ({ page, db }) => {
  const { company, a } = await fixture(db)
  await openPanel(page, company)
  const patchPath = `${ordersPath}/${a}/estado`
  let patches = 0
  page.on('request', request => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === patchPath) patches++
  })
  await page.route(`**${patchPath}`, async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    await route.abort('failed')
  }, { times: 1 })

  await openOrder(page, a)
  const dialog = page.getByRole('dialog')
  const refreshed = page.waitForResponse(response => listQuery(response.request()))
  await dialog.getByRole('button', { name: 'Guardar Estado' }).click()
  expect((await refreshed).ok()).toBe(true)
  await expect(dialog.getByText('No pudimos actualizar el estado del pedido. Verificá su estado actual.')).toBeVisible()
  await expect(dialog.getByRole('combobox')).toHaveValue('ENVIADO')
  await expect(rowFor(page, a)).toContainText('En preparación')
  expect(patches).toBe(1)
  expect((await persisted(db, a))[0]?.estado).toBe('EN_PREPARACION')
})
