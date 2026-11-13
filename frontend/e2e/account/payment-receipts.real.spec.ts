import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

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

async function openOrder(page: Page) {
  await page.goto('/mi-cuenta/pedidos')
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
  await particularRow.getByRole('button', { name: 'Marcar revisado' }).click()
  await expect(particularRow.getByText(/^Revisado/)).toBeVisible()

  const reloaded = await openOrder(page)
  await expect(reloaded.getByText(/^Revisado/)).toBeVisible()
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

  await page.route(/\/api\/pedidos\/\d+\/comprobantes(?:\?.*)?$/, async route => {
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

  const region = await openOrder(page)
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

  await page.route(
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
    const previousRegion = await openOrder(page)
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
