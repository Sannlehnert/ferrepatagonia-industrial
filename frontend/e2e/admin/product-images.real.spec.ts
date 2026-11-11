import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test, type Locator, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const sharp = require('../../../backend/node_modules/sharp')
const uploadRoute = /\/api\/admin\/productos(?:\/\d+)?\/con-imagen$/
const photoInput = (page: Page) => page.getByLabel('Foto del producto (opcional)')
const field = (page: Page, label: string) => page.locator('form label').filter({ hasText: label })
  .locator('xpath=following-sibling::input[1]')

async function signIn(page: Page, email = 'admin@e2e.test') {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/(admin\/dashboard|mi-cuenta\/datos)$/)
}

async function photo(width: number) {
  return {
    name: 'producto.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width, height: 16, channels: 3, background: '#2c6598' } }).png().toBuffer(),
  }
}

async function expectLoaded(image: Locator, width: number) {
  await image.scrollIntoViewIfNeeded()
  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty('naturalWidth', width)
}

test('alta y reemplazo con vista previa, estado de carga y catálogo a 360 px', async ({ page, browser }, info) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await signIn(page)
  await page.goto('/admin/productos')
  const code = 'IMG-E2E-' + randomUUID().slice(0, 8)
  const name = 'Foto E2E ' + code
  await page.getByRole('button', { name: '+ Nuevo Producto' }).click()
  await field(page, 'Nombre del Producto').fill(name)
  await field(page, 'Código SKU').fill(code)
  await page.locator('form').getByRole('combobox').selectOption({ label: 'Herramientas E2E' })
  await field(page, 'Precio Base').fill('150')
  await field(page, 'Stock').fill('8')
  await photoInput(page).setInputFiles({ name: 'invalida.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
  await expect(page.getByRole('alert')).toContainText('Seleccioná una foto JPEG, PNG o WebP.')
  await expect(page.getByRole('button', { name: 'Crear Producto', exact: true })).toBeDisabled()
  await photoInput(page).setInputFiles(await photo(24))
  await expectLoaded(page.getByRole('img', { name: 'Vista previa de la foto' }), 24)
  expect(await page.locator('form').evaluate(form => form.scrollWidth <= form.clientWidth)).toBe(true)
  await info.attach('vista-previa-360', { body: await page.screenshot(), contentType: 'image/png' })

  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let submissions = 0
  await page.route(uploadRoute, async route => {
    submissions++
    await pending
    await route.continue()
  })
  const created = page.waitForResponse(response => uploadRoute.test(response.url()) && response.status() === 201)
  try {
    await page.getByRole('button', { name: 'Crear Producto', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Subiendo foto...' })).toBeDisabled()
    await expect(photoInput(page)).toBeDisabled()
  } finally {
    release()
  }
  const product = await (await created).json()
  expect(submissions).toBe(1)
  await page.unroute(uploadRoute)
  const visitorContext = await browser.newContext({
    baseURL: new URL(page.url()).origin, viewport: { width: 360, height: 780 },
  })
  try {
    await expectLoaded(page.getByRole('img', { name, exact: true }), 24)
    const visitor = await visitorContext.newPage()
    await visitor.goto('/catalogo?busqueda=' + code)
    await expectLoaded(visitor.getByRole('img', { name, exact: true }), 24)
    await visitor.getByRole('link', { name, exact: true }).click()
    await expect(visitor.getByRole('heading', { name, level: 1, exact: true })).toBeVisible()
    await expectLoaded(visitor.getByRole('img', { name, exact: true }), 24)

    const edit = page.getByRole('button', { name: 'Editar ' + name, exact: true })
    await edit.click()
    await expectLoaded(page.getByRole('img', { name: 'Foto actual del producto' }), 24)
    await photoInput(page).setInputFiles(await photo(32))
    await expectLoaded(page.getByRole('img', { name: 'Vista previa de la foto' }), 32)

    await page.route(uploadRoute, route => route.abort('failed'), { times: 1 })
    await page.getByRole('button', { name: 'Guardar Cambios' }).click()
    await expect(page.locator('form').getByRole('alert')).toContainText('No se pudo confirmar el resultado.')
    await page.locator('form').getByRole('button', { name: 'Recargar listado' }).click()
    await expect(page.locator('form')).toHaveCount(0)
    await edit.click()
    await expectLoaded(page.getByRole('img', { name: 'Foto actual del producto' }), 24)
    await photoInput(page).setInputFiles(await photo(32))
    await page.route(uploadRoute, route => route.fulfill({
      status: 503, json: { code: 'PRODUCT_IMAGE_REJECTED', message: 'Almacenamiento temporalmente inaccesible.' },
    }), { times: 1 })
    await page.getByRole('button', { name: 'Guardar Cambios' }).click()
    await expect(page.locator('form').getByRole('alert')).toContainText('Almacenamiento temporalmente inaccesible.')
    await expect(page.getByRole('button', { name: 'Guardar Cambios' })).toBeEnabled()
    const replaced = page.waitForResponse(response => uploadRoute.test(response.url()) && response.status() === 200)
    await page.getByRole('button', { name: 'Guardar Cambios' }).click()
    expect((await (await replaced).json()).imagen).not.toBe(product.imagen)
    await visitor.reload()
    await expectLoaded(visitor.getByRole('img', { name, exact: true }), 32)
    await info.attach('detalle-reemplazado-360', { body: await visitor.screenshot(), contentType: 'image/png' })
  } finally {
    await visitorContext.close()
    const cleanup = await page.request.put('/api/admin/productos/' + product.id_producto, {
      headers: { Origin: new URL(page.url()).origin }, data: { imagen: null, activo: false },
    })
    expect(cleanup.status()).toBe(200)
  }
})

test('Home carga la foto y el cambio de sesión protege el endpoint ADMIN', async ({ page }, info) => {
  await signIn(page)
  const origin = new URL(page.url()).origin
  const asset = await photo(40)
  const endpoint = '/api/admin/productos/1/con-imagen'
  const send = () => page.request.put(endpoint, {
    headers: { Origin: origin },
    multipart: { producto: '{}', imagen: asset },
  })
  expect((await send()).status()).toBe(200)
  try {
    await page.goto('/')
    await expectLoaded(page.getByRole('img', { name: 'Producto E2E 01', exact: true }), 40)
    await info.attach('home-con-foto', { body: await page.screenshot(), contentType: 'image/png' })
    await page.goto('/admin/dashboard')
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    expect((await send()).status()).toBe(401)
    await signIn(page, 'cliente@e2e.test')
    expect((await send()).status()).toBe(403)
  } finally {
    const login = await page.request.post('/api/auth/login', {
      headers: { Origin: origin }, data: { email: 'admin@e2e.test', password: 'E2eLocal-214!' },
    })
    expect(login.status()).toBe(200)
    const reset = await page.request.put('/api/admin/productos/1', { headers: { Origin: origin }, data: { imagen: null } })
    expect(reset.status()).toBe(200)
  }
})
