import { expect, test } from '@playwright/test'
import type { AccountList, AccountQuery } from '../../src/types/adminAccount'
import { adminAccounts, adminDetail, adminList, apiError, clientAccount, data, fixture, login, logout, own } from './support'

const client = (key: string) => fixture.clients[key]!

test('build de producción muestra datos REAL del backend y bloquea DEMO y el libro mixto', async ({ page }) => {
  await login(page, client('real'))
  await clientAccount(page)
  expect(await data<AccountQuery>(await page.request.get(own))).toMatchObject({ origen: 'REAL', saldo: '80.00', disponible: '420.00' })
  const cards = page.getByRole('region', { name: 'Resumen de la cuenta' })
  await expect(cards).toContainText(/80,00/)
  await expect(cards).toContainText(/420,00/)
  await expect(page.getByRole('table')).toContainText(/80,00/)
  await logout(page)

  await login(page, client('empresa30'))
  await clientAccount(page)
  await apiError(await page.request.get(own), 500)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(cards).toHaveCount(0)
  await expect(page.getByRole('table')).toHaveCount(0)
  await logout(page)

  await login(page, client('mixta'))
  const rejection = page.waitForResponse(r => new URL(r.url()).pathname === own)
  await clientAccount(page)
  await apiError(await rejection, 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE')
  await expect(page.getByRole('alert')).toHaveText('No pudimos consultar tu cuenta corriente. Intentá nuevamente.')
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible()
  await expect(cards).toHaveCount(0)
  await expect(page.getByRole('table')).toHaveCount(0)
  for (const path of ['/movimientos?limite=25', '/vencimientos']) {
    await apiError(await page.request.get(own + path), 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE')
  }
})

test('ADMIN fuera del perfil DEMO bloquea el libro mixto y recupera las cuentas REAL con un filtro', async ({ page }) => {
  await login(page, fixture.admin)
  const rejection = page.waitForResponse(r => new URL(r.url()).pathname === adminList)
  await adminAccounts(page)
  await apiError(await rejection, 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE')
  await expect(page.getByRole('alert')).toContainText('no está disponible')
  await expect(page.getByRole('table')).toHaveCount(0)

  const mixed = adminDetail(client('mixta').clientId)
  for (const path of [mixed, mixed + '/movimientos?limite=25', mixed + '/vencimientos']) {
    await apiError(await page.request.get(path), 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE')
  }
  expect((await data<AccountList>(await page.request.get(adminList + '?clienteId=' + client('empresa30').clientId))).items).toEqual([])
  const id = client('real').clientId
  await page.getByLabel('ID de cliente', { exact: true }).fill(String(id))
  await page.getByRole('button', { name: 'Aplicar filtros' }).click()
  const row = page.getByRole('table').first().locator('tbody tr')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('USD 80,00')
  const result = await data<AccountList>(await page.request.get(adminList + '?clienteId=' + id))
  expect(result.items.map(i => [i.clienteId, i.origen, i.saldo])).toEqual([[id, 'REAL', '80.00']])
})
