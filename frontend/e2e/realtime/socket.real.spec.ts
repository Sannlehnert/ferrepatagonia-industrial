import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test as base, type Page, type WebSocketRoute } from '@playwright/test'

const require = createRequire(import.meta.url)
interface Session {
  connection: { query<T = unknown>(sql: string, values: unknown[]): Promise<T>; end(): Promise<void> }
}
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<Session>
}
const { createOrderFixture } = require('../../../backend/test/helpers/account-order.fixture.cjs') as {
  createOrderFixture(session: Session): Promise<{
    clientId: number; accountId: number; productId: number; userId: number; adminId: number
  }>
}
const bcrypt = require('../../../backend/node_modules/bcrypt')
const sockets = '**/socket.io/**'
const orders = '/api/pedidos/cuenta-corriente'

function database() {
  const profile = process.env.CCE2E_TEST_PROFILE
  if (!profile) throw new Error('Ejecutá las pruebas con backend/test/helpers/run-e2e.cjs')
  return connectOwned(JSON.parse(profile), 'E2E')
}

async function seed(session: Session) {
  const f = await createOrderFixture(session)
  const password = 'Socket-' + randomUUID() + '!'
  const name = 'Producto Socket ' + f.productId
  const client = randomUUID() + '@example.test'
  const admin = randomUUID() + '@example.test'
  const hash = await bcrypt.hash(password, 4)
  for (const [email, id] of [[client, f.userId], [admin, f.adminId]]) {
    await session.connection.query('UPDATE USUARIO SET email = ?, password_hash = ? WHERE id_usuario = ?', [email, hash, id])
  }
  await session.connection.query('UPDATE PRODUCTO SET nombre = ? WHERE id_producto = ?', [name, f.productId])
  return { ...f, client, admin, password, name }
}

const test = base.extend<{ fixture: Awaited<ReturnType<typeof seed>> }>({
  fixture: async ({}, use) => {
    const session = await database()
    try { await use(await seed(session)) }
    finally { await session.connection.end() }
  },
})
test.setTimeout(60_000)

async function login(page: Page, email: string, password: string, admin = false) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(admin ? /\/admin(?:\/|$)/ : /\/mi-cuenta\/datos$/)
}

function observeSocket(page: Page) {
  const state = { upgraded: 0, closed: 0, events: [] as string[] }
  page.on('websocket', ws => {
    if (new URL(ws.url()).pathname !== '/socket.io/') return
    ws.on('framesent', ({ payload }) => { if (payload === '5') state.upgraded++ })
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string' && payload.startsWith('42')) state.events.push(payload)
    })
    ws.on('close', () => { state.closed++ })
  })
  return state
}

const quantity = (page: Page, name: string) => page.getByRole('spinbutton', { name: 'Cantidad de ' + name }).first()
const empty = (page: Page) => page.getByText('Tu carrito está vacío.', { exact: true }).first()
async function setQuantity(page: Page, name: string, count: number) {
  const field = quantity(page, name)
  await field.fill(String(count))
  await field.press('Tab')
}
async function setStock(admin: Page, id: number, stock: number) {
  const origin = new URL(admin.url()).origin
  const response = await admin.request.patch('/api/admin/productos/' + id + '/stock', {
    data: { stock }, headers: { Origin: origin },
  })
  expect(response.status()).toBe(200)
}
async function currentStock(page: Page, id: number) {
  const result = await page.request.get('/api/catalogo/' + id)
  expect(result.status()).toBe(200)
  return (await result.json()).data.producto.stock
}

test('carrito entre navegadores, aislamiento de otro cliente y logout', async ({ browser, page, fixture: f }) => {
  const second = await browser.newContext()
  const outsider = await browser.newContext()
  try {
    const sibling = await second.newPage()
    const other = await outsider.newPage()
    await login(page, f.client, f.password)
    await login(sibling, f.client, f.password)
    await login(other, 'cliente-nuevo@e2e.test', 'E2eLocal-214!')
    const removed = await page.request.delete('/api/carrito/items/' + f.productId, {
      headers: { Origin: new URL(page.url()).origin },
    })
    expect(removed.status()).toBe(204)
    const otherSocket = observeSocket(other)
    const siblingSocket = observeSocket(sibling)
    await other.goto('/carrito')
    await sibling.goto('/carrito')
    await expect(empty(sibling)).toBeVisible()
    await expect.poll(() => siblingSocket.upgraded).toBe(1)
    await expect.poll(() => otherSocket.upgraded).toBe(1)
    await page.goto('/producto/' + f.productId)
    await page.getByRole('button', { name: 'Agregar', exact: true }).click()
    await expect(quantity(sibling, f.name)).toHaveValue('1')
    const drawer = page.getByRole('dialog', { name: 'Tu carrito' })
    await setQuantity(page, f.name, 3)
    await expect(quantity(sibling, f.name)).toHaveValue('3')
    await drawer.getByRole('button', { name: 'Eliminar ' + f.name + ' del carrito' }).click()
    await expect(empty(sibling)).toBeVisible()
    expect(await currentStock(page, f.productId)).toBe(5)
    expect(otherSocket.events.filter(event => event.includes('carrito.actualizado.v1'))).toEqual([])
    await expect(other.getByText(f.name, { exact: true })).toHaveCount(0)

    const sharedCookieTab = await second.newPage()
    const sharedCookieSocket = observeSocket(sharedCookieTab)
    await sharedCookieTab.goto('/carrito')
    await expect.poll(() => sharedCookieSocket.upgraded).toBe(1)
    await sibling.getByRole('link', { name: /Mi cuenta/ }).first().click()
    expect(siblingSocket.upgraded).toBe(1)
    await sibling.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect.poll(() => siblingSocket.closed).toBe(1)
    await expect.poll(() => sharedCookieSocket.closed).toBe(1)
    await expect(sibling).toHaveURL(/\/login|\/$/)
    await login(sibling, 'cliente-nuevo@e2e.test', 'E2eLocal-214!')
    await expect.poll(() => sharedCookieSocket.upgraded).toBe(2)
    await page.getByRole('button', { name: 'Agregar', exact: true }).click()
    await expect(sharedCookieTab.getByText(f.name, { exact: true })).toHaveCount(0)
    expect(sharedCookieSocket.events.filter(event => event.includes('carrito.actualizado.v1'))).toEqual([])
  } finally {
    await second.close()
    await outsider.close()
  }
})

test('stock ADMIN y compra real recuperada por evento con un solo cargo', async ({ browser, page, fixture: f }) => {
  const second = await browser.newContext()
  const administration = await browser.newContext()
  try {
    const sibling = await second.newPage()
    const detail = await second.newPage()
    const admin = await administration.newPage()
    await login(page, f.client, f.password)
    await login(sibling, f.client, f.password)
    await login(admin, f.admin, f.password, true)
    const socket = observeSocket(page)
    await page.goto('/carrito')
    await sibling.goto('/carrito')
    await detail.goto('/producto/' + f.productId)
    await expect(quantity(sibling, f.name)).toHaveValue('2')
    await expect(detail.getByText('5 unidades disponibles')).toBeVisible()
    await setStock(admin, f.productId, 6)
    await expect(detail.getByText('6 unidades disponibles')).toBeVisible()
    await expect.poll(() => socket.upgraded).toBe(1)

    let posts = 0
    let committed = 0
    await page.route('**' + orders, async route => {
      if (route.request().method() !== 'POST') return route.continue()
      posts++
      const response = await route.fetch()
      committed = response.status()
      await route.abort('failed')
    })
    const summary = page.getByRole('region', { name: 'Resumen del carrito' })
    await summary.getByRole('radio', { name: 'Cuenta corriente' }).check()
    await summary.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
    await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' })).toContainText('USD 20.00')
    await expect(empty(sibling)).toBeVisible()
    await expect(detail.getByText('4 unidades disponibles')).toBeVisible()
    expect(socket.events.some(event => event.includes('pedido.confirmado.v1'))).toBe(true)
    expect(posts).toBe(1)
    expect(committed).toBe(201)
    expect(await currentStock(page, f.productId)).toBe(4)
    const session = await database()
    try {
      const [row] = await session.connection.query<[{ orders: number; charges: number }]>(
        `SELECT (SELECT COUNT(*) FROM PEDIDO WHERE id_cliente = ?) AS orders,
         (SELECT COUNT(*) FROM MOVIMIENTO_CUENTA_CORRIENTE
          WHERE id_cuenta_corriente = ? AND tipo_movimiento = 'CARGO') AS charges`, [f.clientId, f.accountId],
      )
      expect([Number(row.orders), Number(row.charges)]).toEqual([1, 1])
    } finally { await session.connection.end() }
  } finally {
    await second.close()
    await administration.close()
  }
})

test('Home y catálogo con filtros reflejan disponibilidad sin navegar', async ({ browser, page, context, fixture: f }) => {
  const adminContext = await browser.newContext()
  try {
    const home = await context.newPage()
    const admin = await adminContext.newPage()
    await login(page, f.client, f.password)
    await login(admin, f.admin, f.password, true)
    const homeSocket = observeSocket(home)
    const listSocket = observeSocket(page)
    await home.goto('/')
    await page.goto('/catalogo?categoria=1&busqueda=E2E-01')
    const badge = (target: Page) => target.locator('li')
      .filter({ has: target.getByRole('heading', { name: 'Producto E2E 01', exact: true }) })
      .getByLabel('Disponibilidad de stock')
    await expect(badge(home)).toHaveText('No disponible')
    await expect(badge(page)).toHaveText('No disponible')
    await expect.poll(() => homeSocket.upgraded).toBe(1)
    await expect.poll(() => listSocket.upgraded).toBe(1)
    try {
      await setStock(admin, 1, 2)
      await expect(badge(home)).toHaveText('Disponible')
      await expect(badge(page)).toHaveText('Disponible')
      await expect(page).toHaveURL(/\/catalogo\?categoria=1&busqueda=E2E-01$/)
    } finally { await setStock(admin, 1, 0) }
  } finally { await adminContext.close() }
})

test('REST funciona sin transporte y la reconexión revalida el carrito y la cookie', async ({ browser, page, context, fixture: f }) => {
  const other = await browser.newContext()
  try {
    const sibling = await other.newPage()
    let online = true
    let wire: WebSocketRoute | undefined
    let upgrades = 0
    let writes = 0
    await page.route(sockets, route => online ? route.continue() : route.abort())
    await page.routeWebSocket(sockets, ws => {
      if (!online) return ws.close()
      wire = ws
      const server = ws.connectToServer()
      ws.onMessage(message => {
        if (message === '5') upgrades++
        server.send(message)
      })
    })
    page.on('request', request => {
      if (/^\/api\/(carrito|pedidos)\b/.test(new URL(request.url()).pathname) &&
          request.method() !== 'GET') writes++
    })
    await login(page, f.client, f.password)
    await login(sibling, f.client, f.password)
    await page.goto('/carrito')
    await sibling.goto('/carrito')
    await expect(quantity(page, f.name)).toHaveValue('2')
    await expect.poll(() => wire !== undefined && upgrades > 0).toBe(true)
    online = false
    await wire!.close({ code: 1011 })
    await setQuantity(page, f.name, 3)
    await expect(quantity(sibling, f.name)).toHaveValue('3')
    await setQuantity(sibling, f.name, 4)
    await expect(quantity(sibling, f.name)).toHaveValue('4')
    await expect(quantity(page, f.name)).toHaveValue('3')
    const before = upgrades
    online = true
    await expect.poll(() => upgrades, { timeout: 15_000 }).toBeGreaterThan(before)
    await expect(quantity(page, f.name)).toHaveValue('4')
    expect(writes).toBe(1)
    expect(await currentStock(page, f.productId)).toBe(5)

    const invalidSession = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/auth/me' && response.status() === 401)
    await context.clearCookies()
    await wire!.close({ code: 1011 })
    await invalidSession
    await expect(quantity(page, f.name)).toHaveCount(0)
    expect(writes).toBe(1)
  } finally { await other.close() }
})
