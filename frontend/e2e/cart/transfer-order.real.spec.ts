import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

interface OwnedSession {
  connection: {
    query<T = unknown>(statement: string, values: unknown[]): Promise<T>
    end(): Promise<void>
  }
}

interface DisposableDatabase {
  session: OwnedSession
  connection: OwnedSession['connection']
  fixtures: OrderFixture[]
}

interface OrderFixture {
  accountId: number | null
  cartId: number
  categoryId: number
  clientId: number
  productId: number
  userId: number
}

interface FixtureOptions {
  clientType?: 'PARTICULAR' | 'EMPRESA'
  companyApproval?: 'APROBADA' | 'PENDIENTE' | 'RECHAZADA' | null
  withAccount?: boolean
  accountEnabled?: number
  quantity?: number
  stock?: number
  price?: string
}

interface Customer extends OrderFixture {
  email: string
  password: string
  name: string
}

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<OwnedSession>
}
const { createOrderFixture } = require('../../../backend/test/helpers/account-order.fixture.cjs') as {
  createOrderFixture(session: OwnedSession, options?: FixtureOptions): Promise<OrderFixture>
}
const bcrypt = require('../../../backend/node_modules/bcrypt')

const endpoint = '/api/pedidos/transferencia'
const creditEndpoint = '/api/pedidos/cuenta-corriente'
const cartEndpoint = '/api/carrito'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=',
  'base64',
)

const databaseTest = test.extend<{ database: DisposableDatabase }>({
  database: async ({}, use) => {
    const profile = process.env.CCE2E_TEST_PROFILE
    if (!profile) throw new Error('Ejecutá las pruebas con backend/test/helpers/run-e2e.cjs')
    const session = await connectOwned(JSON.parse(profile), 'E2E')
    const database = { session, connection: session.connection, fixtures: [] as OrderFixture[] }
    try {
      await use(database)
    } finally {
      try {
        // Los productos y categorías creados por estas pruebas no deben quedar
        // visibles para las suites de catálogo que comparten la base temporal.
        for (const fixture of database.fixtures) {
          await session.connection.query(
            'UPDATE PRODUCTO SET activo = 0 WHERE id_producto = ?',
            [fixture.productId],
          )
          await session.connection.query(
            'UPDATE CATEGORIA SET activo = 0 WHERE id_categoria = ?',
            [fixture.categoryId],
          )
        }
      } finally {
        await session.connection.end()
      }
    }
  },
})

async function customer(
  database: DisposableDatabase,
  options: FixtureOptions = {},
): Promise<Customer> {
  const fixture = await createOrderFixture(database.session, options)
  database.fixtures.push(fixture)
  const email = randomUUID() + '@example.test'
  const password = 'Transfer-' + randomUUID() + '!'
  const name = 'Producto transferencia ' + fixture.productId
  await database.connection.query(
    'UPDATE USUARIO SET email = ?, password_hash = ? WHERE id_usuario = ?',
    [email, await bcrypt.hash(password, 4), fixture.userId],
  )
  await database.connection.query(
    'UPDATE PRODUCTO SET nombre = ? WHERE id_producto = ?',
    [name, fixture.productId],
  )
  return { ...fixture, email, password, name }
}

async function signIn(page: Page, f: Customer) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(f.email)
  await page.getByLabel(/^Contraseña/).fill(f.password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/mi-cuenta$/)
}

async function openCheckout(page: Page) {
  const eligibility = page.waitForResponse(response =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === endpoint + '/eligibilidad')
  await page.goto('/carrito')
  const response = await eligibility
  expect(response.status()).toBe(200)
  return (await response.json()).data as {
    elegible: boolean
    totalUSD: string | null
    codigo: string | null
    mensaje: string | null
    cotizacion: string | null
  }
}

async function state(database: DisposableDatabase, f: OrderFixture) {
  const db = database.connection
  const [product] = await db.query<{ stock: number }[]>(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?', [f.productId],
  )
  const items = await db.query<{ id_producto: number, cantidad: number }[]>(
    'SELECT id_producto, cantidad FROM ITEM_CARRITO WHERE id_carrito = ? ORDER BY id_producto',
    [f.cartId],
  )
  const orders = await db.query<{
    id_pedido: number
    estado: string
    modalidad_pago: string
    total: string
    moneda_total: string
  }[]>(
    `SELECT id_pedido, estado, modalidad_pago, total, moneda_total
     FROM PEDIDO WHERE id_cliente = ? ORDER BY id_pedido`,
    [f.clientId],
  )
  const movements = await db.query<{ id_pedido: number, monto: string }[]>(
    `SELECT m.id_pedido, m.monto
     FROM MOVIMIENTO_CUENTA_CORRIENTE m
     INNER JOIN CUENTA_CORRIENTE c ON c.id_cuenta_corriente = m.id_cuenta_corriente
     WHERE c.id_cliente = ? ORDER BY m.id_movimiento_cuenta`,
    [f.clientId],
  )
  const payments = await db.query<{ id_pedido: number }[]>(
    'SELECT id_pedido FROM PAGO WHERE id_pedido IN (SELECT id_pedido FROM PEDIDO WHERE id_cliente = ?)',
    [f.clientId],
  )
  const attempts = await db.query<{
    clave: string
    estado: string
    http_status: number | null
    id_pedido: number | null
  }[]>(
    `SELECT clave, estado, http_status, id_pedido
     FROM CONFIRMACION_PEDIDO_TRANSFERENCIA
     WHERE id_cliente = ? ORDER BY fecha_creacion, clave`,
    [f.clientId],
  )
  const details = await db.query<{ cantidad: number, subtotal: string }[]>(
    `SELECT d.cantidad, d.subtotal
     FROM DETALLE_PEDIDO d
     INNER JOIN PEDIDO p ON p.id_pedido = d.id_pedido
     WHERE p.id_cliente = ? ORDER BY d.id_detalle_pedido`,
    [f.clientId],
  )
  const receipts = await db.query<{
    id_pedido: number | null
    id_cuenta_corriente: number | null
    tipo_mime: string
    id_admin_revision: number | null
  }[]>(
    `SELECT id_pedido, id_cuenta_corriente, tipo_mime, id_admin_revision
     FROM COMPROBANTE_PAGO WHERE id_cliente = ? ORDER BY fecha_utc, id_comprobante`,
    [f.clientId],
  )

  return {
    stock: product.stock,
    items,
    orders,
    movements,
    payments,
    attempts,
    details,
    receipts,
  }
}

async function replay(page: Page, key: string, cotizacion: string) {
  return page.request.post(endpoint, {
    headers: {
      Origin: new URL(page.url()).origin,
      'Idempotency-Key': key,
    },
    data: { cotizacion },
  })
}

for (const width of [360, 1280]) {
  databaseTest(`particular: transfiere, vacía el carrito y adjunta el comprobante (${width}px)`, async ({
    page, database,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    const f = await customer(database, {
      clientType: 'PARTICULAR',
      withAccount: false,
    })
    await signIn(page, f)
    const quote = await openCheckout(page)

    const summary = page.getByRole('region', { name: 'Resumen del carrito' })
    await expect(summary).toContainText('USD 20.00')
    await expect(summary.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    await expect(summary.getByRole('radio', { name: 'Cuenta corriente' })).toHaveCount(0)
    expect(quote).toMatchObject({ elegible: true, totalUSD: '20.00', moneda: 'USD' })

    const confirmation = page.waitForResponse(response =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === endpoint)
    await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
    const response = await confirmation
    expect(response.status()).toBe(201)
    const key = response.request().headers()['idempotency-key']!
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    const result = await response.json()
    const orderId = result.data.pedidoId as number
    expect(result.data).toMatchObject({
      estado: 'CONFIRMADO',
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      totalUSD: '20.00',
    })

    await expect(page.getByRole('status').filter({
      hasText: 'Pedido #' + orderId + ' registrado por USD 20.00.',
    })).toContainText('Este registro no significa que el pago haya sido aprobado.')
    await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()

    const receipts = page.getByRole('region', { name: 'Comprobantes de pago' })
    await receipts.getByLabel(/Archivo \(PDF/).setInputFiles({
      name: 'transferencia.png', mimeType: 'image/png', buffer: png,
    })
    await receipts.getByRole('button', { name: 'Adjuntar comprobante' }).click()
    await expect(receipts.getByText(/Comprobante recibido/)).toBeVisible()
    await expect(receipts.getByText('Pendiente de revisión')).toBeVisible()

    const committed = await state(database, f)
    expect(committed).toMatchObject({
      stock: 3,
      items: [],
      orders: [{
        id_pedido: orderId,
        estado: 'CONFIRMADO',
        modalidad_pago: 'TRANSFERENCIA',
        total: '20.00',
        moneda_total: 'USD',
      }],
      movements: [],
      payments: [],
      attempts: [{
        clave: key,
        estado: 'CONFIRMADO',
        http_status: 201,
        id_pedido: orderId,
      }],
      details: [{ cantidad: 2, subtotal: '20.00' }],
      receipts: [{
        id_pedido: orderId,
        id_cuenta_corriente: null,
        tipo_mime: 'image/png',
        id_admin_revision: null,
      }],
    })

    const recovered = await page.request.get(endpoint + '/' + key)
    expect(recovered.status()).toBe(200)
    expect(await recovered.json()).toEqual(result)

    const replayed = await replay(page, key, quote.cotizacion!)
    expect(replayed.status()).toBe(200)
    expect((await replayed.json()).data.pedidoId).toBe(orderId)
    expect(await state(database, f)).toEqual(committed)

    const blockedCredit = await page.request.get(creditEndpoint + '/eligibilidad')
    expect(blockedCredit.status()).toBe(200)
    expect((await blockedCredit.json()).data).toMatchObject({
      elegible: false,
      codigo: 'CUENTA_NO_HABILITADA',
    })

    const blockedCreditOrder = await page.request.post(creditEndpoint, {
      headers: {
        Origin: new URL(page.url()).origin,
        'Idempotency-Key': randomUUID(),
      },
      data: { cotizacion: quote.cotizacion! },
    })
    expect(blockedCreditOrder.status()).toBe(403)
    expect(await blockedCreditOrder.json()).toMatchObject({
      code: 'CUENTA_NO_HABILITADA',
      estado: 'RECHAZADO',
    })

    const cart = await page.request.get(cartEndpoint)
    expect(cart.status()).toBe(200)
    expect((await cart.json()).items).toEqual([])

    if (width === 360) {
      const scrollWidth = await page.locator('html').evaluate(element => element.scrollWidth)
      expect(scrollWidth).toBeLessThanOrEqual(360)
    }
  })
}

databaseTest('empresa aprobada con crédito elige transferencia sin tocar su cuenta corriente', async ({
  page, database,
}) => {
  const f = await customer(database, {
    clientType: 'EMPRESA',
    companyApproval: 'APROBADA',
    withAccount: true,
    accountEnabled: 1,
  })
  await signIn(page, f)
  const before = (await (await page.request.get('/api/cuenta-corriente')).json()).data

  const transferQuote = await openCheckout(page)
  expect(transferQuote).toMatchObject({ elegible: true, totalUSD: '20.00' })

  const credit = await page.request.get(creditEndpoint + '/eligibilidad')
  expect(credit.status()).toBe(200)
  expect((await credit.json()).data).toMatchObject({ elegible: true, totalUSD: '20.00' })

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await expect(summary.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
  await expect(summary.getByRole('radio', { name: 'Cuenta corriente' })).toBeVisible()

  const confirmation = page.waitForResponse(response =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === endpoint)
  await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
  const response = await confirmation
  expect(response.status()).toBe(201)
  const result = await response.json()

  const committed = await state(database, f)
  expect(committed).toMatchObject({
    stock: 3,
    items: [],
    orders: [{ id_pedido: result.data.pedidoId, modalidad_pago: 'TRANSFERENCIA', total: '20.00' }],
    movements: [],
    payments: [],
  })

  const after = (await (await page.request.get('/api/cuenta-corriente')).json()).data
  expect({ saldo: after.saldo, disponible: after.disponible, revision: after.revision }).toEqual({
    saldo: before.saldo,
    disponible: before.disponible,
    revision: before.revision,
  })
})

databaseTest('empresa pendiente o rechazada no confirma por transferencia y conserva el carrito', async ({
  page, database,
}) => {
  for (const approval of ['PENDIENTE', 'RECHAZADA'] as const) {
    const f = await customer(database, {
      clientType: 'EMPRESA',
      companyApproval: approval,
      withAccount: false,
    })
    await signIn(page, f)
    const quote = await openCheckout(page)
    expect(quote).toMatchObject({
      elegible: false,
      totalUSD: null,
      codigo: 'EMPRESA_NO_HABILITADA',
      cotizacion: null,
    })

    const summary = page.getByRole('region', { name: 'Resumen del carrito' })
    await expect(summary.getByRole('alert')).toContainText('La empresa no está aprobada para esta operación.')
    await expect(summary.getByRole('button', { name: 'Finalizar compra' })).toBeDisabled()
    await expect(summary.getByRole('button', { name: 'Confirmar pedido por transferencia' })).toHaveCount(0)
    await expect(summary.getByRole('radio', { name: 'Transferencia' })).toHaveCount(0)

    const blocked = await page.request.post(endpoint, {
      headers: {
        Origin: new URL(page.url()).origin,
        'Idempotency-Key': randomUUID(),
      },
      data: { cotizacion: 'a'.repeat(40) },
    })
    expect(blocked.status()).toBe(403)
    expect(await blocked.json()).toMatchObject({
      code: 'EMPRESA_NO_HABILITADA',
      estado: 'RECHAZADO',
    })

    const after = await state(database, f)
    expect(after.stock).toBe(5)
    expect(after.items).toEqual([{ id_producto: f.productId, cantidad: 2 }])
    expect(after.orders).toEqual([])
    expect(after.movements).toEqual([])
    expect(after.payments).toEqual([])
    expect(after.attempts).toMatchObject([
      { estado: 'RECHAZADO', http_status: 403, id_pedido: null },
    ])

    await page.goto('/mi-cuenta')
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
  }
})

databaseTest('recupera una respuesta HTTP perdida con la misma clave y aísla la sesión', async ({
  page, database,
}) => {
  // Fuerza la recuperación manual por REST cuando el transporte en tiempo real
  // no entrega el evento posterior al COMMIT.
  await page.route('**/socket.io/**', route => route.abort())
  const f = await customer(database, { clientType: 'PARTICULAR', withAccount: false })
  const other = await customer(database, {
    clientType: 'PARTICULAR', withAccount: false, quantity: 1, stock: 10,
  })
  await signIn(page, f)
  await openCheckout(page)

  let key = ''
  let orderId = 0
  await page.route('**' + endpoint, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    key = route.request().headers()['idempotency-key']!
    // El servidor procesa el pedido, pero el navegador nunca recibe la respuesta.
    const response = await page.request.post(endpoint, {
      headers: {
        Origin: new URL(page.url()).origin,
        'Idempotency-Key': key,
      },
      data: route.request().postDataJSON(),
    })
    expect(response.status()).toBe(201)
    orderId = (await response.json()).data.pedidoId
    await route.abort('failed')
  }, { times: 1 })

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
  const recovery = summary.getByRole('button', { name: 'Consultar resultado' })
  await expect(recovery).toBeEnabled()

  const committed = await state(database, f)
  expect(committed).toMatchObject({
    stock: 3,
    items: [],
    orders: [{ id_pedido: orderId, estado: 'CONFIRMADO', modalidad_pago: 'TRANSFERENCIA' }],
    movements: [],
    payments: [],
    attempts: [{ clave: key, estado: 'CONFIRMADO', http_status: 201, id_pedido: orderId }],
  })

  const recoveredResponse = page.waitForResponse(response =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === endpoint + '/' + key)
  // El botón desaparece en cuanto llega el resultado; evitamos que la acción
  // quede reintentando sobre un nodo desmontado.
  await recovery.dispatchEvent('click')
  const recovered = await recoveredResponse
  expect(recovered.status()).toBe(200)
  expect((await recovered.json()).data).toMatchObject({
    pedidoId: orderId,
    modalidadPago: 'TRANSFERENCIA',
    totalUSD: '20.00',
  })
  await expect(page.getByRole('status').filter({
    hasText: 'Pedido #' + orderId + ' registrado por USD 20.00.',
  })).toBeVisible()
  await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()
  expect(await page.evaluate(id => sessionStorage.getItem('transfer-order:' + id), f.userId))
    .toBeNull()
  expect(await state(database, f)).toEqual(committed)

  await page.goto('/mi-cuenta')
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await signIn(page, other)
  await page.goto('/carrito')
  await expect(page.getByRole('region', { name: 'Resumen del carrito' }))
    .toContainText('USD 10.00')
  await expect(page.getByText('Pedido #' + orderId + ' registrado', { exact: false })).toHaveCount(0)
  expect((await page.request.get(endpoint + '/' + key)).status()).toBe(404)
  expect(await page.evaluate(id => sessionStorage.getItem('transfer-order:' + id), f.userId))
    .toBeNull()

  const otherState = await state(database, other)
  expect(otherState.orders).toEqual([])
  expect(otherState.stock).toBe(10)
  expect(otherState.items).toEqual([{ id_producto: other.productId, cantidad: 1 }])
})

databaseTest('un rechazo por precio desactualizado conserva los ítems y permite reintentar', async ({
  page, database,
}) => {
  const f = await customer(database, { clientType: 'PARTICULAR', withAccount: false })
  await signIn(page, f)
  await openCheckout(page)

  const db = database.connection
  await db.query('UPDATE PRODUCTO SET precio = 15.00 WHERE id_producto = ?', [f.productId])
  await db.query(
    'UPDATE PRECIO_USD_EVIDENCIA SET precio_verificado = 15.00 WHERE id_producto = ? AND valida = 1',
    [f.productId],
  )

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  const rejected = page.waitForResponse(response =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === endpoint)
  await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
  const rejection = await rejected
  expect(rejection.status()).toBe(409)
  const oldKey = rejection.request().headers()['idempotency-key']!
  expect(await rejection.json()).toMatchObject({ code: 'COTIZACION_DESACTUALIZADA', estado: 'RECHAZADO' })
  await expect(summary.getByRole('alert')).toContainText('El carrito o sus precios cambiaron')

  const rejectedState = await state(database, f)
  expect(rejectedState.stock).toBe(5)
  expect(rejectedState.items).toEqual([{ id_producto: f.productId, cantidad: 2 }])
  expect(rejectedState.orders).toEqual([])
  expect(rejectedState.movements).toEqual([])
  expect(rejectedState.payments).toEqual([])
  expect(rejectedState.attempts).toEqual([
    { clave: oldKey, estado: 'RECHAZADO', http_status: 409, id_pedido: null },
  ])

  const refreshed = page.waitForResponse(response =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === endpoint + '/eligibilidad')
  await summary.getByRole('button', { name: 'Actualizar carrito y total para reintentar' }).click()
  expect((await (await refreshed).json()).data).toMatchObject({
    elegible: true,
    totalUSD: '30.00',
  })

  const confirmed = page.waitForResponse(response =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === endpoint)
  await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
  const confirmation = await confirmed
  expect(confirmation.status()).toBe(201)
  const newKey = confirmation.request().headers()['idempotency-key']!
  expect(newKey).not.toBe(oldKey)
  const result = await confirmation.json()
  expect(result.data.totalUSD).toBe('30.00')

  const committed = await state(database, f)
  expect(committed.stock).toBe(3)
  expect(committed.items).toEqual([])
  expect(committed.orders).toEqual([
    { id_pedido: result.data.pedidoId, estado: 'CONFIRMADO', modalidad_pago: 'TRANSFERENCIA', total: '30.00', moneda_total: 'USD' },
  ])
  expect(committed.movements).toEqual([])
  expect(committed.payments).toEqual([])
  expect(committed.attempts).toHaveLength(2)
  expect(committed.attempts).toEqual(expect.arrayContaining([
    { clave: oldKey, estado: 'RECHAZADO', http_status: 409, id_pedido: null },
    { clave: newKey, estado: 'CONFIRMADO', http_status: 201, id_pedido: result.data.pedidoId },
  ]))
})

databaseTest('bloquea un segundo clic mientras la transferencia está en vuelo', async ({
  page, database,
}) => {
  const f = await customer(database, { clientType: 'PARTICULAR', withAccount: false })
  await signIn(page, f)
  await openCheckout(page)

  let posts = 0
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**' + endpoint, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    posts++
    await gate
    await route.continue()
  })

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  try {
    const confirmation = page.waitForResponse(response =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === endpoint)
    await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
    const submitting = summary.getByRole('button', { name: 'Registrando pedido…' })
    await expect(submitting).toBeDisabled()
    await expect.poll(() => posts).toBe(1)

    await submitting.dispatchEvent('click')
    expect(posts).toBe(1)

    release()
    expect((await confirmation).status()).toBe(201)
  } finally {
    release()
  }

  await expect(page.getByRole('status').filter({
    hasText: /Pedido #\d+ registrado por USD 20\.00\./,
  })).toBeVisible()
  const committed = await state(database, f)
  expect(committed.orders).toHaveLength(1)
  expect(committed.attempts).toHaveLength(1)
  expect(committed.stock).toBe(3)
  expect(committed.items).toEqual([])
  expect(posts).toBe(1)
})
