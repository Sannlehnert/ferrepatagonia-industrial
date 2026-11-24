import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { withOwnedDb } from '../helpers/owned-db'

const password = 'E2eLocal-214!'
const createdIds: number[] = []

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}

function formField(form: Locator, label: string) {
  return form.locator('label').filter({ hasText: label })
    .locator('xpath=following-sibling::input[1]')
}

async function filter(page: Page, code: string) {
  const search = page.getByLabel('Buscar productos por nombre o SKU')
  await search.fill(code)
  await expect(page).toHaveURL(new RegExp(`busqueda=${encodeURIComponent(code)}`))
  await expect(page.getByRole('table', { name: 'Productos del catálogo' })).toBeVisible()
}

test.afterAll(async () => {
  if (!createdIds.length) return
  try {
    await withOwnedDb(async connection => {
      const marks = createdIds.map(() => '?').join(', ')
      await connection.query(`DELETE FROM PRECIO_USD_EVIDENCIA WHERE id_producto IN (${marks})`, createdIds)
      await connection.query(`DELETE FROM PRODUCTO WHERE id_producto IN (${marks})`, createdIds)
    })
  } catch (error) {
    console.error('No se pudo limpiar el fixture de verificación de precios.', error)
  }
})

test('ADMIN verifica precio desde la lista y desde el formulario, e invalida al editar', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  await loginAdmin(page)
  await page.goto('/admin/productos')

  const code = `E2E-PRECIO-${randomUUID().slice(0, 8)}`
  const name = `Producto precio ${code}`
  const editedName = `${name} editado`
  const form = page.getByRole('dialog', { name: 'Crear Nuevo Producto' })

  // 1. Alta sin verificación: queda pendiente.
  await page.getByRole('button', { name: '+ Nuevo Producto', exact: true }).click()
  await formField(form, 'Nombre del Producto').fill(name)
  await formField(form, 'Código SKU').fill(code)
  await form.getByRole('combobox').selectOption({ label: 'Herramientas E2E' })
  await formField(form, 'Importe base cargado').fill('150')
  await formField(form, 'Stock').fill('9')
  const createdResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/admin/productos' &&
    response.request().method() === 'POST')
  await form.getByRole('button', { name: 'Crear Producto', exact: true }).click()
  const created = await createdResponse
  expect(created.status(), await created.text()).toBe(201)
  const productId = (await created.json()).id_producto as number
  createdIds.push(productId)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await filter(page, code)
  const row = page.getByRole('table', { name: 'Productos del catálogo' }).locator('tbody tr').first()
  await expect(row.getByRole('button', { name: `Verificar precio de ${name}` })).toBeVisible()

  // 2. Verificación desde la acción de la fila.
  await row.getByRole('button', { name: `Verificar precio de ${name}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Verificar precio' })
  await expect(dialog.getByText('Precio cargado: USD 150,00')).toBeVisible()
  await dialog.getByLabel(/Evidencia comercial/).fill(
    `Factura comercial E2E-354 folio 0001 proveedor Andes`,
  )
  await dialog.getByLabel('Confirmo que revisé manualmente el precio y la evidencia.').check()
  await page.screenshot({
    path: '../docs/354/evidence/admin-price-verification-1280.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 900 })
  expect(await page.evaluate(
    'document.documentElement.scrollWidth <= window.innerWidth',
  )).toBe(true)
  await page.screenshot({
    path: '../docs/354/evidence/admin-price-verification-390.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  const verifyResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/admin/productos/${productId}/verificar-precio` &&
    response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Verificar precio', exact: true }).click()
  const verified = await verifyResponse
  expect(verified.status(), await verified.text()).toBe(200)
  const verifiedBody = (await verified.json()).data as {
    precio: string
    estadoFer17: string
    publicado: boolean
    replay: boolean
  }
  expect(verifiedBody).toMatchObject({ precio: '150.00', estadoFer17: 'DEFINIDO', publicado: true, replay: false })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Precio verificado.' })).toBeVisible()
  await expect(row.getByRole('button', { name: `Verificar precio de ${name}` })).toHaveCount(0)

  const publicLine = await page.request.post('/api/precios', {
    headers: { Origin: new URL(page.url()).origin },
    data: { moneda: 'USD', productos: [{ productoId: productId, cantidad: 1 }] },
  })
  expect(publicLine.ok(), await publicLine.text()).toBe(true)
  expect((await publicLine.json()).data.productos[0]).toMatchObject({
    estadoPrecio: 'DEFINIDO', precioBaseUSD: '150.00', precioComprable: true,
  })

  // 3. Editar el importe invalida la evidencia y vuelve a habilitar la verificación.
  await row.getByRole('button', { name: `Editar ${name}`, exact: true }).click()
  const editForm = page.getByRole('dialog', { name: /^Editar Producto #/ })
  await formField(editForm, 'Nombre del Producto').fill(editedName)
  await formField(editForm, 'Importe base cargado').fill('175.50')
  const updateResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/admin/productos/${productId}` &&
    response.request().method() === 'PUT')
  await editForm.getByRole('button', { name: 'Guardar Cambios', exact: true }).click()
  expect((await updateResponse).status()).toBe(200)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await filter(page, code)
  const editedRow = page.getByRole('table', { name: 'Productos del catálogo' }).locator('tbody tr').first()
  await expect(editedRow.getByRole('button', { name: `Verificar precio de ${editedName}` })).toBeVisible()
  await editedRow.getByRole('button', { name: `Verificar precio de ${editedName}` }).click()
  const secondDialog = page.getByRole('dialog', { name: 'Verificar precio' })
  await expect(secondDialog.getByText('Precio cargado: USD 175,50')).toBeVisible()
  await secondDialog.getByLabel(/Evidencia comercial/).fill(
    `Factura comercial E2E-354 folio 0002 proveedor Andes`,
  )
  await secondDialog.getByLabel('Confirmo que revisé manualmente el precio y la evidencia.').check()
  await secondDialog.getByRole('button', { name: 'Verificar precio', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Precio verificado.' })).toBeVisible()

  // 4. Alta desde el formulario con verificación en el mismo flujo.
  const withVerificationCode = `E2E-PRECIO-VER-${randomUUID().slice(0, 8)}`
  const withVerificationName = `Producto verificado ${withVerificationCode}`
  await page.getByRole('button', { name: '+ Nuevo Producto', exact: true }).click()
  const createVerifiedForm = page.getByRole('dialog', { name: 'Crear Nuevo Producto' })
  await formField(createVerifiedForm, 'Nombre del Producto').fill(withVerificationName)
  await formField(createVerifiedForm, 'Código SKU').fill(withVerificationCode)
  await createVerifiedForm.getByRole('combobox').selectOption({ label: 'Herramientas E2E' })
  await formField(createVerifiedForm, 'Importe base cargado').fill('200')
  await formField(createVerifiedForm, 'Stock').fill('4')
  await createVerifiedForm.getByLabel('Verificar este precio al guardar').check()
  await createVerifiedForm.getByLabel(/Evidencia comercial/).fill(
    `Factura comercial E2E-354 folio 0003 proveedor Andes`,
  )
  await createVerifiedForm.getByLabel('Confirmo que revisé manualmente el precio y la evidencia.').check()
  const createVerified = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/admin/productos' &&
    response.request().method() === 'POST')
  const verifyDuringCreate = page.waitForResponse(response =>
    /^\/api\/admin\/productos\/\d+\/verificar-precio$/.test(new URL(response.url()).pathname) &&
    response.request().method() === 'POST')
  await createVerifiedForm.getByRole('button', { name: 'Crear y verificar', exact: true }).click()
  const createdVerifiedResponse = await createVerified
  expect(createdVerifiedResponse.status()).toBe(201)
  const withVerificationId = (await createdVerifiedResponse.json()).id_producto as number
  createdIds.push(withVerificationId)
  const verifyDuringCreateResponse = await verifyDuringCreate
  expect(verifyDuringCreateResponse.status()).toBe(200)
  await expect(page.getByRole('status').filter({ hasText: 'Precio verificado y publicado por FER-17.' })).toBeVisible()

  await filter(page, withVerificationCode)
  const verifiedRow = page.getByRole('table', { name: 'Productos del catálogo' }).locator('tbody tr').first()
  await expect(verifiedRow).toContainText(withVerificationName)
  await expect(verifiedRow.getByRole('button', { name: `Verificar precio de ${withVerificationName}` })).toHaveCount(0)
})
