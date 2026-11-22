import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=',
  'base64',
)

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  const logout = page.getByRole('button', { name: 'Cerrar sesión', exact: true })
  const menu = page.getByRole('button', { name: 'Menú de navegación de cuenta' })
  await expect(logout.or(menu)).toBeVisible()
}

async function upload(region: Locator) {
  await region.getByLabel(/Archivo \(PDF/).setInputFiles({
    name: 'transferencia.png', mimeType: 'image/png', buffer: png,
  })
  await region.getByRole('button', { name: 'Adjuntar comprobante' }).click()
  await expect(region.getByText(/Comprobante recibido/)).toBeVisible()
  await expect(region.getByText('Pendiente de revisión')).toBeVisible()
}

async function download(page: Page, row: Locator) {
  const pending = page.waitForEvent('download')
  await row.getByRole('link', { name: 'Descargar comprobante' }).click()
  const file = await pending
  expect(file.suggestedFilename()).toMatch(/^comprobante-[0-9a-f-]+\.png$/)
  expect(await readFile(await file.path())).toEqual(png)
}

async function openOrder(page: Page, beforeDetail?: () => Promise<unknown>) {
  await page.goto('/mi-cuenta/pedidos')
  await expect(page.getByRole('button', { name: /^Ver detalle de PED-/ })).toBeVisible()
  await expect(page.getByText('Consultando estados de comprobantes…', { exact: true })).toHaveCount(0)
  await beforeDetail?.()
  await page.getByRole('button', { name: /^Ver detalle de PED-/ }).click()
  return page.getByRole('region', { name: 'Comprobantes de pago' })
}

test('particular, empresa y administración recorren los comprobantes reales en pantalla', async ({ page, browser }) => {
  await signIn(page, 'cliente@e2e.test')
  const particular = await openOrder(page)
  await upload(particular)
  const privatePath = await particular.getByRole('link', { name: 'Descargar comprobante' }).getAttribute('href')
  expect(privatePath).toMatch(/^\/api\/pedidos\/\d+\/comprobantes\//)
  await download(page, particular)

  const company = await browser.newPage()
  await signIn(company, 'empresa-cuenta@e2e.test')
  expect((await company.request.get(privatePath!)).status()).toBe(404)
  await company.goto('/mi-cuenta/cuenta-corriente')
  const account = company.getByRole('region', { name: 'Comprobantes de pago' })
  const before = (await (await company.request.get('/api/cuenta-corriente')).json()).data
  expect(before.saldo).toBe('84.00')
  await upload(account)
  await expect(account.getByText(/Saldo general de cuenta corriente · PNG/)).toBeVisible()
  await download(company, account)
  await account.getByRole('link', { name: 'Mis pedidos' }).click()
  await expect(company).toHaveURL(/\/mi-cuenta\/pedidos$/)
  await company.getByRole('button', { name: /^Ver detalle de PED-/ }).click()
  const reference = company.getByRole('region', { name: 'Comprobantes de pago' })
  await upload(reference)
  await expect(reference.getByText(/Pedido PED-\d+ · PNG/)).toBeVisible()
  const after = (await (await company.request.get('/api/cuenta-corriente')).json()).data
  expect({ saldo: after.saldo, revision: after.revision }).toEqual({ saldo: before.saldo, revision: before.revision })

  const admin = await browser.newPage()
  await signIn(admin, 'admin@e2e.test')
  await admin.getByRole('link', { name: 'Comprobantes de pago', exact: true }).click()
  const adminReceipts = admin.getByRole('region', { name: 'Comprobantes de pago' })
  await expect(adminReceipts.getByRole('listitem')).toHaveCount(3)
  const particularRow = adminReceipts.getByRole('listitem').filter({ hasText: 'Cliente E2E · Cliente 1' })
  await expect(particularRow).toContainText(/Pedido PED-\d+ · PNG/)
  await download(admin, particularRow)
  const [reviewRequest] = await Promise.all([
    admin.waitForRequest(request =>
      new URL(request.url()).pathname.endsWith('/revision') && request.method() === 'PATCH'),
    particularRow.getByRole('button', { name: 'Aprobar comprobante' }).click(),
  ])
  expect(reviewRequest.headers()['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  expect(reviewRequest.postDataJSON()).toEqual({ estado: 'APROBADO' })
  await expect(particularRow.getByText('Aprobado', { exact: true })).toBeVisible()

  const reloaded = await openOrder(page)
  await expect(reloaded.getByText('Aprobado', { exact: true })).toBeVisible()
  await company.close()
  await admin.close()
});

test('rechaza archivos inválidos antes de enviarlos', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await signIn(page, 'cliente@e2e.test')
  const region = await openOrder(page)
  const input = region.getByLabel(/Archivo \(PDF/)
  const submit = region.getByRole('button', {
    name: 'Adjuntar comprobante',
  })

  let submissions = 0
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (
      request.method() === 'POST' &&
      /^\/api\/pedidos\/\d+\/comprobantes$/.test(path)
    ) {
      submissions++
    }
  })

  const files = [
    {
      name: 'vacio.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(0),
    },
    {
      name: 'documento.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('archivo no permitido'),
    },
    {
      name: 'demasiado-grande.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    },
  ]

  for (const file of files) {
    await input.setInputFiles(file)
    await expect(region.getByRole('alert')).toHaveText(
      'Seleccioná un PDF, JPG o PNG con contenido y de hasta 5 MB.',
    )
    await expect(submit).toBeDisabled()
  }

  expect(submissions).toBe(0)

  await input.setInputFiles({
    name: 'transferencia.png',
    mimeType: 'image/png',
    buffer: png,
  })

  await expect(region.getByRole('alert')).toHaveCount(0)
  await expect(submit).toBeEnabled()

  const scrollWidth = await page.locator('html').evaluate(
    element => element.scrollWidth,
  )
  expect(scrollWidth).toBeLessThanOrEqual(360)
})

test('permite reintentar la consulta y la carga después de un error', async ({
  page,
}) => {
  await signIn(page, 'cliente@e2e.test')

  let failRead = true
  let failUpload = true

  const interceptDetail = () => page.route(/\/api\/pedidos\/\d+\/comprobantes(?:\?.*)?$/, async route => {
    const method = route.request().method()

    if (method === 'GET' && failRead) {
      failRead = false
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Servicio no disponible.' }),
      })
      return
    }

    if (method === 'POST' && failUpload) {
      failUpload = false
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Servicio no disponible.' }),
      })
      return
    }

    await route.continue()
  })

  const region = await openOrder(page, interceptDetail)
  await expect(region.getByRole('alert')).toHaveText(
    'No se pudieron cargar los comprobantes.',
  )

  await region.getByRole('button', {
    name: 'Reintentar comprobantes',
  }).click()
  await expect(region.getByRole('alert')).toHaveCount(0)

  await region.getByLabel(/Archivo \(PDF/).setInputFiles({
    name: 'transferencia.png',
    mimeType: 'image/png',
    buffer: png,
  })

  const submit = region.getByRole('button', {
    name: 'Adjuntar comprobante',
  })
  await submit.click()

  await expect(region.getByRole('alert')).toHaveText(
    'No se pudo procesar el comprobante. Reintentá en unos instantes.',
  )
  await expect(submit).toBeEnabled()

  await submit.click()
  await expect(region.getByRole('alert')).toHaveCount(0)
  await expect(region.getByRole('status').filter({
    hasText: /Comprobante recibido|Este comprobante ya estaba registrado/,
  })).toBeVisible()
  await expect(region.getByRole('link', {
    name: 'Descargar comprobante',
  })).toBeVisible()
})

test('muestra la carga y bloquea envíos repetidos a 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await signIn(page, 'cliente@e2e.test')

  let releaseUpload = () => {}
  const uploadGate = new Promise<void>(resolve => {
    releaseUpload = resolve
  })
  let submissions = 0

  await page.route(/\/api\/pedidos\/\d+\/comprobantes$/, async route => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }

    submissions++
    await uploadGate
    await route.continue()
  })

  try {
    const region = await openOrder(page)
    const input = region.getByLabel(/Archivo \(PDF/)

    await input.setInputFiles({
      name: 'transferencia.png',
      mimeType: 'image/png',
      buffer: png,
    })
    await region.getByRole('button', {
      name: 'Adjuntar comprobante',
    }).click()

    await expect(region.getByRole('button', {
      name: 'Subiendo…',
    })).toBeDisabled()
    await expect(input).toBeDisabled()
    await expect.poll(() => submissions).toBe(1)

    releaseUpload()

    await expect(region.getByRole('status').filter({
      hasText: /Comprobante recibido|Este comprobante ya estaba registrado/,
    })).toBeVisible()
    await expect(region.getByRole('button', {
      name: 'Adjuntar comprobante',
    })).toBeDisabled()
    expect(submissions).toBe(1)
  } finally {
    releaseUpload()
  }
})

test('descarta una consulta de comprobantes de la sesión anterior', async ({
  page,
}) => {
  await signIn(page, 'cliente@e2e.test')

  let releaseRead = () => {}
  const readGate = new Promise<void>(resolve => {
    releaseRead = resolve
  })

  let markReadStarted = () => {}
  const readStarted = new Promise<void>(resolve => {
    markReadStarted = resolve
  })

  let delayed = false
  let previousOrderPath = ''

  const interceptDetail = () => page.route(
    /\/api\/pedidos\/\d+\/comprobantes(?:\?.*)?$/,
    async route => {
      if (route.request().method() !== 'GET' || delayed) {
        await route.continue()
        return
      }

      delayed = true
      previousOrderPath = new URL(route.request().url()).pathname

      const response = await route.fetch()
      markReadStarted()
      await readGate
      await route.fulfill({ response })
    },
  )

  try {
    const previousRegion = await openOrder(page, interceptDetail)
    await readStarted

    await expect(previousRegion.getByRole('status')).toHaveText(
      'Cargando comprobantes…',
    )

    const logoutResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/auth/logout' &&
      response.request().method() === 'POST',
    )
    await page.getByRole('button', {
      name: 'Cerrar sesión',
      exact: true,
    }).click()
    expect((await logoutResponse).ok()).toBe(true)

    await signIn(page, 'empresa-cuenta@e2e.test')
    const currentRegion = await openOrder(page)

    await expect(currentRegion.getByRole('status')).toHaveCount(0)

    releaseRead()

    await expect(currentRegion.getByRole('link', {
      name: 'Descargar comprobante',
    })).toBeVisible()

    const links = await currentRegion.getByRole('link', {
      name: 'Descargar comprobante',
    }).evaluateAll(elements =>
      elements.map(element => element.getAttribute('href')),
    )

    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(href).not.toBeNull()
      expect(href).not.toContain(previousOrderPath + '/')
    }

    const denied = await page.request.get(previousOrderPath)
    expect(denied.status()).toBe(404)
  } finally {
    releaseRead()
  }
})

for (const width of [1280, 360]) {
  test(`listado y detalle comparten comprobantes persistidos a ${width} px`, async ({ page, browser }) => {
    test.setTimeout(45_000)
    await page.setViewportSize({ width, height: 850 })
    await page.addInitScript(() => {
      localStorage.setItem('ferrepatagonia_uploaded_receipts', '[1,999999]')
    })
    await signIn(page, 'cliente@e2e.test')
    const orders = await page.request.get('/api/pedidos')
    expect(orders.ok()).toBe(true)
    const order = (await orders.json()).data.items[0]
    const path = `/api/pedidos/${order.pedidoId}/comprobantes`
    const before = await page.request.get(path)
    expect(before.ok()).toBe(true)
    const previousReceipts = (await before.json()).data.items
    const hasApproved = previousReceipts.some((item: { estadoRevision: string }) =>
      item.estadoRevision === 'APROBADO')
    const initialStatus = hasApproved ? 'Aprobado'
      : previousReceipts.some((item: { estadoRevision: string }) =>
        item.estadoRevision === 'PENDIENTE') ? 'Pendiente de revisión'
        : previousReceipts.length ? 'Rechazado' : 'No adjunto'

    await page.goto('/mi-cuenta/pedidos')
    const row = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: order.numero, exact: true }),
    })
    await expect(row.getByText(initialStatus, { exact: true })).toBeVisible()
    const opener = row.getByRole('button', { name: `Ver comprobantes de ${order.numero}` })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: `Comprobantes · ${order.numero}` })
    const receipts = dialog.getByRole('region', { name: 'Comprobantes de pago' })

    // Un PNG distinto por escenario evita que la deduplicación reutilice el archivo de otro test.
    const sharp = createRequire(import.meta.url)('../../../backend/node_modules/sharp')
    const image: Buffer = await sharp({ create: {
      width: 2, height: 2, channels: 3, background: { r: width === 1280 ? 30 : 80, g: 120, b: 40 },
    } }).png().toBuffer()
    await receipts.getByLabel(/Archivo \(PDF/).setInputFiles({
      name: 'comprobante-327.png', mimeType: 'image/png', buffer: image,
    })
    const savedResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === path && response.request().method() === 'POST')
    await receipts.getByRole('button', { name: 'Adjuntar comprobante' }).click()
    const saved = await savedResponse
    expect(saved.status()).toBe(201)
    const receiptId = (await saved.json()).data.id
    const href = `${path}/${receiptId}`
    await expect(receipts.getByText('Comprobante recibido. La acreditación del pago se gestiona por separado.')).toBeVisible()
    await expect(receipts.getByText('Pendiente de revisión', { exact: true })).toBeVisible()
    await expect(row.getByText(hasApproved ? 'Aprobado' : 'Pendiente de revisión', { exact: true })).toBeVisible()

    const downloaded = page.waitForEvent('download')
    await receipts.locator('a').filter({ hasText: 'Descargar comprobante' })
      .and(receipts.locator(`a[href="${href}"]`)).click()
    expect(await readFile(await (await downloaded).path())).toEqual(image)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()

    await row.getByRole('button', { name: `Ver detalle de ${order.numero}`, exact: true }).click()
    const detailReceipts = row.getByRole('region', { name: 'Comprobantes de pago' })
    await expect(detailReceipts.locator(`a[href="${href}"]`)).toBeVisible()
    await expect(detailReceipts.getByText('Pendiente de revisión', { exact: true }).first()).toBeVisible()

    const admin = await browser.newPage()
    try {
      await signIn(admin, 'admin@e2e.test')
      await admin.getByRole('link', { name: 'Comprobantes de pago', exact: true }).click()
      const pendingIds = previousReceipts
        .filter((item: { estadoRevision: string }) => item.estadoRevision === 'PENDIENTE')
        .map((item: { id: string }) => item.id)
      for (const id of [...pendingIds, receiptId]) {
        const adminRow = admin.getByRole('listitem').filter({
          has: admin.locator(`a[href="/api/admin/comprobantes/${id}"]`),
        })
        const [reviewRequest] = await Promise.all([
          admin.waitForRequest(request =>
            new URL(request.url()).pathname === `/api/admin/comprobantes/${id}/revision`
            && request.method() === 'PATCH'),
          adminRow.getByRole('button', { name: 'Aprobar comprobante' }).click(),
        ])
        expect(reviewRequest.headers()['idempotency-key']).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        )
        expect(reviewRequest.postDataJSON()).toEqual({ estado: 'APROBADO' })
        await expect(adminRow.getByText('Aprobado', { exact: true })).toBeVisible()
      }
    } finally {
      await admin.close()
    }

    await page.reload()
    await expect(row.getByText('Aprobado', { exact: true })).toBeVisible()
    await page.getByLabel('Estado del Comprobante').selectOption('APROBADO')
    await expect(row).toBeVisible()
    await page.getByLabel('Estado del Comprobante').selectOption('RECHAZADO')
    await expect(row).toHaveCount(0)
    await page.getByLabel('Estado del Comprobante').selectOption('NO_ADJUNTO')
    await expect(row).toHaveCount(0)
    await page.getByRole('button', { name: 'Limpiar filtros' }).click()
    await expect(row).toBeVisible()
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  })
}

test('un error de consulta no se presenta como ausencia de comprobantes', async ({ page }) => {
  await signIn(page, 'cliente@e2e.test')
  let fail = true
  await page.route(/\/api\/pedidos\/\d+\/comprobantes(?:\?.*)?$/, async route => {
    if (fail && route.request().method() === 'GET') {
      await route.fulfill({ status: 503, json: { message: 'Consulta no disponible.' } })
    } else {
      await route.continue()
    }
  })
  await page.goto('/mi-cuenta/pedidos')
  await expect(page.getByText('Estado no disponible', { exact: true })).toBeVisible()
  await expect(page.getByRole('listitem').getByText('No adjunto', { exact: true })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Reintentar estados de comprobantes', exact: true }).click()
  await expect(page.getByRole('listitem').getByText('Aprobado', { exact: true })).toBeVisible()
  await expect(page.getByText('Estado no disponible', { exact: true })).toHaveCount(0)
})

for (const client of [
  { email: 'cliente@e2e.test', other: 'empresa-cuenta@e2e.test', company: false },
  { email: 'empresa-cuenta@e2e.test', other: 'cliente@e2e.test', company: true },
]) {
  test(`transferencia y comprobante privado en historial: ${client.email}`, async ({ page, browser }) => {
    test.setTimeout(60_000)
    await page.route('**/socket.io/**', route => route.abort())
    await signIn(page, client.email)
    const before = client.company ? (await (await page.request.get('/api/cuenta-corriente')).json()).data : null
    await page.goto('/catalogo?busqueda=E2E-24')
    const card = page.locator('li').filter({
      has: page.getByRole('heading', { name: 'Producto E2E 24', exact: true }),
    })
    const added = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/carrito/items' && response.request().method() === 'POST')
    await card.getByRole('button', { name: 'Agregar', exact: true }).click()
    expect((await added).status()).toBe(204)
    await page.goto('/carrito')

    const summary = page.getByRole('region', { name: 'Resumen del carrito' })
    await expect(summary.getByRole('radio', { name: 'Transferencia' })).toBeVisible()
    if (client.company) {
      await expect(summary.getByRole('radio', { name: 'Cuenta corriente' })).toBeVisible()
    } else {
      await expect(summary.getByRole('radio', { name: 'Cuenta corriente' })).toHaveCount(0)
    }
    const submitted = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/pedidos/transferencia' &&
      response.request().method() === 'POST')
    await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
    const response = await submitted
    expect(response.status()).toBe(201)
    const orderId: number = (await response.json()).data.pedidoId
    await expect(page.getByRole('status').filter({
      hasText: 'El pago por transferencia está pendiente de acreditación',
    })).toContainText('no significa que el pago haya sido aprobado')
    await expect(page.getByRole('region', { name: 'Comprobantes de pago' })).toBeVisible()

    await page.goto('/mi-cuenta/pedidos')
    const history = (await (await page.request.get('/api/pedidos')).json()).data.items
    const savedOrder = history.find((order: { pedidoId: number }) => order.pedidoId === orderId)
    expect(savedOrder).toBeDefined()
    const orderNumber: string = savedOrder.numero
    const row = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: orderNumber, exact: true }),
    })
    await expect(row.getByText('No adjunto', { exact: true })).toBeVisible()
    await row.getByRole('button', { name: `Ver detalle de ${orderNumber}` }).click()
    const detailReceipts = row.getByRole('region', { name: 'Comprobantes de pago' })
    await expect(detailReceipts).toBeVisible()
    await upload(detailReceipts)
    await expect(row.getByRole('row').first().getByText('Pendiente de revisión', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: `Ver comprobantes de ${orderNumber}` }).click()
    const dialog = page.getByRole('dialog', { name: `Comprobantes · ${orderNumber}` })
    await expect(detailReceipts).toHaveCount(0)
    await expect(dialog.getByText('Pendiente de revisión', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(detailReceipts).toBeVisible()

    const other = await browser.newPage()
    try {
      await signIn(other, client.other)
      expect((await other.request.get(`/api/pedidos/${orderId}/comprobantes`)).status()).toBe(404)
    } finally {
      await other.close()
    }
    if (before) {
      const after = (await (await page.request.get('/api/cuenta-corriente')).json()).data
      expect({ saldo: after.saldo, revision: after.revision }).toEqual({ saldo: before.saldo, revision: before.revision })
    }
  })
}
