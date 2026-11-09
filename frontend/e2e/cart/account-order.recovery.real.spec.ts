import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

interface OwnedSession {
  connection: {
    query<T = unknown>(statement: string, values: unknown[]): Promise<T>
    end(): Promise<void>
  }
}

interface DisposableDatabase extends OwnedSession {
  session: OwnedSession
  categoryIds: number[]
}

interface OrderFixture {
  accountId: number
  cartId: number
  categoryId: number
  clientId: number
  productId: number
  userId: number
}

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<OwnedSession>
}
const { createOrderFixture } = require('../../../backend/test/helpers/account-order.fixture.cjs') as {
  createOrderFixture(session: OwnedSession): Promise<OrderFixture>
}
const bcrypt = require('../../../backend/node_modules/bcrypt')
const endpoint = '/api/pedidos/cuenta-corriente'
const cartEndpoint = '/api/carrito'
const recovery = (page: Page) => page.getByRole('button', { name: 'Consultar resultado', exact: true })
const receipt = (page: Page, orderId: number) => page.getByText(new RegExp('Pedido #' + orderId + ' confirmado'))
const emptyCart = (page: Page) => page.getByText('Tu carrito está vacío.', { exact: true })
const resultResponse = (page: Page, key: string) => page.waitForResponse(r => r.url().endsWith(endpoint + '/' + key))

function gate() {
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  return { ready, release }
}

const recoveryTest = test.extend<{ database: DisposableDatabase }>({
  database: async ({}, use) => {
    const profile = process.env.CCE2E_TEST_PROFILE
    if (!profile) throw new Error('Ejecutá las pruebas con backend/test/helpers/run-e2e.cjs')
    const session = await connectOwned(JSON.parse(profile), 'E2E')
    const database = { session, connection: session.connection, categoryIds: [] as number[] }
    try {
      await use(database)
    } finally {
      try {
        // Los casos de catálogo del mismo runner usan el seed original.
        for (const id of database.categoryIds) {
          await session.connection.query('UPDATE CATEGORIA SET activo = 0 WHERE id_categoria = ?', [id])
        }
      } finally {
        await session.connection.end()
      }
    }
  },
})

async function customer(database: DisposableDatabase) {
  const f = await createOrderFixture(database.session)
  database.categoryIds.push(f.categoryId)
  const email = randomUUID() + '@example.test'
  const password = 'Recovery-' + randomUUID() + '!'
  const name = 'Producto de recuperación ' + f.productId
  await database.connection.query(
    'UPDATE USUARIO SET email = ?, password_hash = ? WHERE id_usuario = ?',
    [email, await bcrypt.hash(password, 4), f.userId],
  )
  await database.connection.query('UPDATE PRODUCTO SET nombre = ? WHERE id_producto = ?', [name, f.productId])
  return { ...f, email, password, name }
}

async function signIn(page: Page, f: Awaited<ReturnType<typeof customer>>) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(f.email)
  await page.getByLabel(/^Contraseña/).fill(f.password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/mi-cuenta\/datos$/)
}

async function attemptInTab(page: Page, userId: number, key: string, quoteToken?: string) {
  await page.evaluate(([id, key, quoteToken]) => {
    sessionStorage.setItem('account-order:' + id, JSON.stringify({ key, quoteToken }))
  }, [userId, key, quoteToken] as const)
}

const saved = (page: Page, userId: number) =>
  page.evaluate(id => sessionStorage.getItem('account-order:' + id), userId)

async function sql(database: DisposableDatabase, f: OrderFixture) {
  const db = database.connection
  const [product] = await db.query<{ stock: number }[]>(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?', [f.productId],
  )
  const items = await db.query('SELECT cantidad FROM ITEM_CARRITO WHERE id_carrito = ?', [f.cartId])
  const orders = await db.query<{ id_pedido: number, total: string, estado: string }[]>(
    'SELECT id_pedido, total, estado FROM PEDIDO WHERE id_cliente = ? ORDER BY id_pedido', [f.clientId],
  )
  const charges = await db.query<{ id_pedido: number, monto: string }[]>(
    "SELECT id_pedido, monto FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ? AND tipo_movimiento = 'CARGO' ORDER BY id_pedido",
    [f.accountId],
  )
  const attempts = await db.query<{ clave: string, estado: string, http_status: number | null }[]>(
    'SELECT clave, estado, http_status FROM CONFIRMACION_PEDIDO_CC WHERE id_cliente = ? ORDER BY clave', [f.clientId],
  )
  return { stock: product.stock, items, orders, charges, attempts }
}

function confirmedOnce(state: Awaited<ReturnType<typeof sql>>, key: string, orderId: number, total = '20.00', stock = 3) {
  expect(state).toEqual({
    stock,
    items: [],
    orders: [{ id_pedido: orderId, total, estado: 'CONFIRMADO' }],
    charges: [{ id_pedido: orderId, monto: total }],
    attempts: [{ clave: key, estado: 'CONFIRMADO', http_status: 201 }],
  })
}

recoveryTest.use({ screenshot: 'off', trace: 'off' })

for (const width of [360, 1280]) {
  recoveryTest.describe(`#263 crédito a ${width}px`, () => {
    recoveryTest.use({ viewport: { width, height: 800 } })

    recoveryTest('recupera la compra y rechaza otra que excede el disponible', async ({ page, database }) => {
      const f = await customer(database)
      const db = database.connection
      await db.query('UPDATE CUENTA_CORRIENTE SET limite_credito = 15 WHERE id_cuenta_corriente = ?', [f.accountId])
      await db.query('DELETE FROM ITEM_CARRITO WHERE id_carrito = ?', [f.cartId])
      await signIn(page, f)

      async function addFromCatalog() {
        await page.goto('/catalogo?busqueda=' + encodeURIComponent(f.name))
        const card = page.locator('li').filter({ has: page.getByRole('heading', { name: f.name, exact: true }) })
        const added = page.waitForResponse(r =>
          r.url().endsWith(cartEndpoint + '/items') && r.request().method() === 'POST')
        await card.getByRole('button', { name: 'Agregar', exact: true }).click()
        expect((await added).status()).toBe(204)
        const eligibility = page.waitForResponse(r => r.url().endsWith(endpoint + '/eligibilidad'))
        await page.goto('/carrito')
        const response = await eligibility
        expect(response.status()).toBe(200)
        return (await response.json()).data
      }

      const summary = page.getByRole('region', { name: 'Resumen del carrito' })
      const eligibility = await addFromCatalog()
      expect(eligibility).toMatchObject({ elegible: true, totalUSD: '10.00', creditoDisponibleUSD: '15.00' })
      await expect(summary).toContainText('USD 10.00')
      await expect(summary).toContainText('USD 15.00')

      let key = ''
      let original: { data: { pedidoId: number, cargoId: string } } | undefined
      await page.route('**' + endpoint, async route => {
        if (route.request().method() !== 'POST') return route.continue()
        const response = await route.fetch()
        expect(response.status()).toBe(201)
        original = await response.json()
        key = route.request().headers()['idempotency-key']
        await route.abort('failed')
      }, { times: 1 })
      await summary.getByRole('radio', { name: 'Cuenta corriente' }).check()
      await summary.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
      await expect(recovery(page)).toBeEnabled()
      const recovered = resultResponse(page, key)
      await recovery(page).click()
      const response = await recovered
      expect(response.status()).toBe(200)
      const result = await response.json()
      expect(original).toBeDefined()
      expect(result).toEqual(original)
      const { pedidoId, cargoId } = result.data
      await expect(receipt(page, pedidoId)).toBeVisible()
      await expect(emptyCart(page)).toBeVisible()
      const cart = await page.request.get(cartEndpoint)
      expect(cart.status()).toBe(200)
      expect((await cart.json()).items).toEqual([])
      const committed = await sql(database, f)
      confirmedOnce(committed, key, pedidoId, '10.00', 4)
      expect(await db.query(
        'SELECT CAST(id_movimiento_cuenta AS CHAR) AS id, moneda FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido = ?',
        [pedidoId],
      )).toEqual([{ id: cargoId, moneda: 'USD' }])

      const account = '/api/cuenta-corriente'
      const accountResponse = page.waitForResponse(r => r.url().endsWith(account))
      await page.goto('/mi-cuenta/cuenta-corriente')
      const read = await accountResponse
      expect(read.status()).toBe(200)
      const { data: balance } = await read.json()
      expect(balance).toMatchObject({ saldo: '10.00', disponible: '5.00', moneda: 'USD' })
      const accountSummary = page.getByRole('region', { name: 'Resumen de la cuenta' })
      await expect(accountSummary.getByRole('article').filter({ hasText: 'Saldo actual (USD)' })).toContainText('10,00')

      const denied = await addFromCatalog()
      expect(denied).toMatchObject({
        elegible: false, codigo: 'CREDITO_INSUFICIENTE', totalUSD: '10.00', creditoDisponibleUSD: '5.00',
      })
      await expect(summary.getByRole('alert')).toContainText('El crédito disponible no alcanza')
      await expect(summary).toContainText('USD 5.00')
      await expect(summary.getByRole('button', { name: 'Finalizar compra' })).toBeDisabled()
      const before = await sql(database, f)
      expect(before).toEqual({ ...committed, items: [{ cantidad: 1 }] })
      const rejectedKey = randomUUID()
      const rejection = await page.request.post(endpoint, {
        headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': rejectedKey },
        data: { cotizacion: denied.cotizacion },
      })
      expect(rejection.status()).toBe(409)
      expect(await rejection.json()).toMatchObject({ code: 'CREDITO_INSUFICIENTE', estado: 'RECHAZADO' })
      const after = await sql(database, f)
      expect(after).toEqual({
        ...before,
        attempts: expect.arrayContaining([
          ...before.attempts, { clave: rejectedKey, estado: 'RECHAZADO', http_status: 409 },
        ]),
      })
      expect(after.attempts).toHaveLength(2)
      const updated = await page.request.get(account)
      expect(updated.status()).toBe(200)
      expect((await updated.json()).data).toMatchObject({
        saldo: '10.00', disponible: '5.00', revision: balance.revision,
      })
    })
  })
}

recoveryTest('H06: recupera un pendiente aunque falle la primera carga del carrito', async ({ page, database }) => {
  const f = await customer(database)
  const db = database.connection
  await db.query('DELETE FROM ITEM_CARRITO WHERE id_carrito = ?', [f.cartId])
  const key = randomUUID()
  await db.query(
    "INSERT INTO CONFIRMACION_PEDIDO_CC (id_cliente, clave, estado) VALUES (?, ?, 'PENDIENTE')",
    [f.clientId, key],
  )
  const before = await sql(database, f)
  await signIn(page, f)
  await attemptInTab(page, f.userId, key)
  let failCart = true
  await page.route('**' + cartEndpoint, route => failCart ? route.abort('failed') : route.continue())
  const first = resultResponse(page, key)
  await page.goto('/carrito')
  expect((await first).status()).toBe(202)
  const reload = page.getByRole('button', { name: 'Volver a consultar carrito' })
  await expect(reload).toBeEnabled()
  await expect(recovery(page)).toBeEnabled()
  const second = resultResponse(page, key)
  await recovery(page).click()
  expect((await second).status()).toBe(202)
  failCart = false
  await reload.click()
  await expect(emptyCart(page)).toBeVisible()
  await expect(recovery(page)).toBeEnabled()
  expect(JSON.parse((await saved(page, f.userId))!).key).toBe(key)
  expect(await sql(database, f)).toEqual(before)
  console.log('H06 SQL sin cambios', JSON.stringify(before))
})

recoveryTest('H07: conserva la clave durante 403, inactividad y cambio de cliente', async ({ page, database }) => {
  const f = await customer(database)
  const other = await customer(database)
  const db = database.connection
  const before = await sql(database, f)
  let key = ''
  let orderId = 0
  let posts = 0
  await page.route('**' + endpoint, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    posts++
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    orderId = (await response.json()).data.pedidoId
    key = route.request().headers()['idempotency-key']
    await route.abort('timedout')
  })
  await signIn(page, f)
  await page.goto('/carrito')
  await page.getByRole('radio', { name: 'Cuenta corriente' }).check()
  await page.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
  await expect(recovery(page)).toBeEnabled()
  const committed = await sql(database, f)
  confirmedOnce(committed, key, orderId)

  await db.query('UPDATE CLIENTE SET activo = 0 WHERE id_cliente = ?', [f.clientId])
  const denied = resultResponse(page, key)
  await recovery(page).click()
  const forbidden = await denied
  expect(forbidden.status()).toBe(403)
  expect(await forbidden.json()).not.toHaveProperty('estado')
  await expect(page).toHaveURL(/\/acceso-denegado$/)
  expect(JSON.parse((await saved(page, f.userId))!).key).toBe(key)
  await db.query('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [f.userId])
  expect((await page.request.get(endpoint + '/' + key)).status()).toBe(401)
  await page.goto('/carrito')
  await expect(page).toHaveURL(/\/login\?/)

  await signIn(page, other)
  await page.goto('/carrito')
  await expect(page.getByRole('radio', { name: 'Cuenta corriente' })).toBeVisible()
  await expect(receipt(page, orderId)).toHaveCount(0)
  await expect(recovery(page)).toHaveCount(0)
  expect((await page.request.get(endpoint + '/' + key)).status()).toBe(404)
  await page.goto('/mi-cuenta/datos')
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)

  await db.query('UPDATE USUARIO SET activo = 1 WHERE id_usuario = ?', [f.userId])
  await db.query('UPDATE CLIENTE SET activo = 1 WHERE id_cliente = ?', [f.clientId])
  await signIn(page, f)
  const recovered = resultResponse(page, key)
  await page.goto('/carrito')
  expect((await recovered).status()).toBe(200)
  await expect(receipt(page, orderId)).toBeVisible()
  await expect(emptyCart(page)).toBeVisible()
  expect(await saved(page, f.userId)).toBeNull()
  expect(posts).toBe(1)
  expect(await sql(database, f)).toEqual(committed)
  console.log('H07 SQL antes y después', JSON.stringify({ before, committed }))
})

recoveryTest('H08: descarta una lectura del carrito anterior al COMMIT', async ({ page, database }) => {
  const f = await customer(database)
  const before = await sql(database, f)
  await signIn(page, f)
  const quote = await page.request.get(endpoint + '/eligibilidad')
  expect(quote.status()).toBe(200)
  const { cotizacion } = (await quote.json()).data
  const key = randomUUID()
  const request = {
    headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': key },
    data: { cotizacion },
  }
  await attemptInTab(page, f.userId, key, cotizacion)
  const captured = gate()
  const releaseOld = gate()
  const oldFinished = gate()
  let reads = 0
  let orderId = 0
  await page.route('**' + cartEndpoint, async route => {
    if (++reads !== 1) return route.continue()
    try {
      const response = await route.fetch()
      expect((await response.json()).items[0].cantidad).toBe(2)
      captured.release()
      await releaseOld.ready
      // El frontend puede cancelar la solicitud vieja antes de que llegue.
      await route.fulfill({ response }).catch(() => {})
    } finally {
      oldFinished.release()
    }
  })
  await page.route('**' + endpoint + '/' + key, async route => {
    await captured.ready
    const response = await page.request.post(endpoint, request)
    expect(response.status()).toBe(201)
    orderId = (await response.json()).data.pedidoId
    return route.continue()
  })
  try {
    await page.goto('/carrito')
    await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' })).toContainText('USD 20.00')
    await expect(emptyCart(page)).toBeVisible()
  } finally {
    releaseOld.release()
  }
  await oldFinished.ready
  expect(reads).toBe(2)
  await expect(receipt(page, orderId)).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Cantidad de ' + f.name })).toHaveCount(0)
  await expect(emptyCart(page)).toBeVisible()
  const committed = await sql(database, f)
  confirmedOnce(committed, key, orderId)
  const replay = await page.request.post(endpoint, request)
  expect(replay.status()).toBe(200)
  expect((await replay.json()).data.pedidoId).toBe(orderId)
  expect(await sql(database, f)).toEqual(committed)

  const added = await page.request.post(cartEndpoint + '/items', {
    headers: { Origin: request.headers.Origin },
    data: { productoId: f.productId, cantidad: 1 },
  })
  expect(added.status()).toBe(204)
  await page.getByRole('button', { name: 'Carrito', exact: true }).click()
  await page.getByRole('dialog', { name: 'Tu carrito' })
    .getByRole('link', { name: 'Ver carrito completo' }).click()
  await page.getByRole('radio', { name: 'Cuenta corriente' }).check()
  const next = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
  const response = await next
  expect(response.status()).toBe(201)
  const secondId = (await response.json()).data.pedidoId
  const secondKey = response.request().headers()['idempotency-key']
  expect(secondKey).not.toBe(key)
  await expect(receipt(page, secondId)).toBeVisible()
  await expect(emptyCart(page)).toBeVisible()
  const second = await sql(database, f)
  expect(second).toEqual({
    stock: 2,
    items: [],
    orders: [...committed.orders, { id_pedido: secondId, total: '10.00', estado: 'CONFIRMADO' }],
    charges: [...committed.charges, { id_pedido: secondId, monto: '10.00' }],
    attempts: expect.arrayContaining([
      ...committed.attempts,
      { clave: secondKey, estado: 'CONFIRMADO', http_status: 201 },
    ]),
  })
  expect(second.attempts).toHaveLength(2)
  console.log('H08 SQL antes, tras replay y segunda compra', JSON.stringify({ before, committed, second }))
})
