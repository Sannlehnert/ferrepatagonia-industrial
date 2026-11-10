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
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible()
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
