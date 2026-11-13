import { createHmac } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import type { AccountList, AccountQuery, Due, Movement } from '../../src/types/adminAccount'
import { adminAccounts, adminDetail, adminList, adminScreen, apiError, data, emittedCursor, fixture, login, logout, nextPage, own, withOwnedDb } from './support'

type Slice<T> = { items: T[]; siguienteCursor: string | null; revision: string; corte: string }
const client = (key: string) => fixture.clients[key]!

function filters(page: Page) {
  return {
    id: page.getByLabel('ID de cliente', { exact: true }),
    enabled: page.getByRole('combobox', { name: 'Habilitación' }),
    apply: page.getByRole('button', { name: 'Aplicar filtros' }),
  }
}

async function lookup(page: Page, id: number) {
  await filters(page).id.fill(String(id))
  await page.getByRole('button', { name: 'Consultar cliente por ID' }).click()
  return page.getByRole('region', { name: 'Cliente ' + id, exact: true })
}

test('ADMIN lista las cuentas #253, pagina, combina filtros y consulta el detalle real', async ({ page }) => {
  await login(page, fixture.admin)
  await adminAccounts(page)
  const list = page.getByRole('table').first().locator('tbody tr')
  const expected = Object.values(fixture.clients).filter(c => c.accountId !== null).map(c => c.clientId).sort((a, b) => a - b)
  const initial = await data<AccountList>(await page.request.get(adminList))
  expect(initial.items.map(i => i.clienteId)).toEqual(expected.slice(0, 25))
  await expect(list).toHaveCount(25)
  const following = page.waitForResponse(r => new URL(r.url()).pathname === adminList && r.url().includes('cursor='))
  await page.getByRole('button', { name: 'Siguiente página de cuentas' }).click()
  const next = await data<AccountList>(await following)
  expect(next.items.map(i => i.clienteId)).toEqual(expected.slice(25))
  await expect(list).toHaveCount(expected.length - 25)

  const disabled = client('inhabilitada'), a = client('empresa30')
  const f = filters(page)
  await f.id.fill(String(disabled.clientId))
  await f.enabled.selectOption('true')
  await f.apply.click()
  await expect(page.getByText('No hay cuentas para estos filtros.')).toBeVisible()
  await f.enabled.selectOption('false')
  await f.apply.click()
  const filtered = await data<AccountList>(await page.request.get(adminList + '?clienteId=' + disabled.clientId + '&habilitada=false'))
  expect(filtered.items.map(i => [i.clienteId, i.estado, i.saldo])).toEqual([[disabled.clientId, 'INHABILITADA', '70.00']])
  await expect(list).toHaveCount(1)
  await expect(list.first()).toContainText('INHABILITADA')
  await page.getByRole('button', { name: 'Consultar cliente ' + disabled.clientId, exact: true }).click()
  await expect(page.getByText('Cuenta inhabilitada. El historial sigue disponible para consulta.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Movimientos', exact: true })).toContainText('USD 70,00')

  const detail = await lookup(page, a.clientId)
  const summary = await data<AccountQuery>(await page.request.get(adminDetail(a.clientId)))
  expect(summary).toMatchObject({ cuentaId: a.accountId, saldo: '225.00', limite: '1000.00', utilizado: '225.00', disponible: '775.00', origen: 'DEMO' })
  for (const [label, amount] of [['Saldo', '225,00'], ['Límite', '1.000,00'], ['Utilizado', '225,00'], ['Disponible', '775,00']]) {
    await expect(detail.getByText(label!, { exact: true }).locator('..').locator('dd')).toHaveText('USD ' + amount)
  }
  const dues = await data<Slice<Due>>(await page.request.get(adminDetail(a.clientId) + '/vencimientos'))
  expect(dues.items.map(d => [d.venceEl, d.pendiente])).toEqual([['2026-03-03', '175.00'], ['2026-04-01', '50.00']])
  const dueTable = detail.getByRole('region', { name: 'Vencimientos', exact: true })
  await expect(dueTable.getByRole('row').filter({ hasText: '2026-03-03' })).toContainText('USD 175,00')
  const moves = await data<Slice<Movement>>(await page.request.get(adminDetail(a.clientId) + '/movimientos'))
  expect(moves.items.map(m => m.id)).toEqual([...a.movements].reverse().map(m => String(m.id)))
  const table = detail.getByRole('region', { name: 'Movimientos', exact: true })
  await expect(table.locator('tbody tr')).toHaveCount(6)
  await expect(table).toContainText('ABONO / ANULADO')
  await expect(table).toContainText('USD 125,00')
  await expect(table).not.toContainText('USD 600,10')
})

test('ADMIN pagina movimientos y vencimientos del cliente seleccionado', async ({ page }) => {
  await login(page, fixture.admin)
  await adminAccounts(page)
  const c = client('paginada')
  const detail = await lookup(page, c.clientId)
  const base = adminDetail(c.clientId)
  const movements = detail.getByRole('region', { name: 'Movimientos', exact: true }).locator('tbody tr')
  const dues = detail.getByRole('region', { name: 'Vencimientos', exact: true }).locator('tbody tr')
  await expect(movements).toHaveCount(25)
  await expect(dues).toHaveCount(25)
  const moves = await data<Slice<Movement>>(await page.request.get(base + '/movimientos'))
  const dates = await data<Slice<Due>>(await page.request.get(base + '/vencimientos'))

  const moreMoves = page.waitForResponse(r => new URL(r.url()).pathname === base + '/movimientos' && r.url().includes('cursor='))
  await detail.getByRole('button', { name: 'Siguiente página de movimientos' }).click()
  const nextMoves = await data<Slice<Movement>>(await moreMoves)
  expect([...moves.items, ...nextMoves.items].map(m => m.id)).toEqual([...c.movements].reverse().map(m => String(m.id)))
  expect(nextMoves.revision).toBe(moves.revision)
  await expect(movements).toHaveCount(2)
  await expect(movements.last()).toContainText('Pedido #' + c.movements[0]!.orderId)

  const moreDates = page.waitForResponse(r => new URL(r.url()).pathname === base + '/vencimientos' && r.url().includes('cursor='))
  await detail.getByRole('button', { name: 'Siguiente página de vencimientos' }).click()
  const nextDates = await data<Slice<Due>>(await moreDates)
  expect([...dates.items, ...nextDates.items].map(d => d.movimientoId)).toEqual(c.movements.map(m => String(m.id)))
  expect(nextDates.revision).toBe(dates.revision)
  await expect(dues).toHaveCount(2)
  await expect(dues.last()).toContainText(String(c.movements.at(-1)!.id))
})

test('ADMIN distingue vacío acreditado, cobertura desconocida y cliente sin cuenta', async ({ page }) => {
  await login(page, fixture.admin)
  await adminAccounts(page)
  const empty = await lookup(page, client('vacia').clientId)
  await expect(empty.getByText('Sin movimientos.', { exact: true })).toBeVisible()
  await expect(empty.getByText('Sin vencimientos abiertos.', { exact: true })).toBeVisible()
  for (const [key, coverage] of [['parcial', 'PARCIAL'], ['incompleta', 'NO_ACREDITADA']] as const) {
    const c = client(key)
    const view = await lookup(page, c.clientId)
    const state = await data<AccountQuery>(await page.request.get(adminDetail(c.clientId)))
    expect(state).toMatchObject({ cobertura: coverage, saldo: null, utilizado: null, disponible: null })
    await expect(view).toContainText('Cobertura ' + coverage)
    await expect(view.getByText('Saldo', { exact: true }).locator('..').locator('dd')).toHaveText('No acreditado')
  }
  const noAccount = client('empresa-sin-cuenta')
  const view = await lookup(page, noAccount.clientId)
  expect(await data<AccountQuery>(await page.request.get(adminDetail(noAccount.clientId)))).toMatchObject({ estado: 'SIN_CUENTA' })
  await expect(view.getByText('El cliente no tiene cuenta corriente asignada.')).toBeVisible()
})

test('ADMIN recibe 503 por un bloqueo real, reintenta y después CLIENTE recibe cuatro 403', async ({ page }) => {
  await login(page, fixture.admin)
  await withOwnedDb(async connection => {
    await connection.query('LOCK TABLES CUENTA_CORRIENTE WRITE')
    try {
      const failed = page.waitForResponse(r => new URL(r.url()).pathname === adminList)
      await adminAccounts(page)
      await apiError(await failed, 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE')
      await expect(page.getByRole('alert')).toContainText('no está disponible')
      await expect(page.getByRole('table')).toHaveCount(0)
    } finally {
      await connection.query('UNLOCK TABLES')
    }
  })
  await page.getByRole('button', { name: 'Reintentar desde la primera página' }).click()
  await expect(page.getByRole('table').first().locator('tbody tr')).toHaveCount(25)
  await logout(page)
  await apiError(await page.request.get(adminList), 401)
  await login(page, client('empresa60'))
  await page.goto(adminScreen)
  await expect(page).toHaveURL(/\/acceso-denegado$/)
  const detail = adminDetail(client('empresa30').clientId)
  for (const path of [adminList, detail, detail + '/movimientos', detail + '/vencimientos']) {
    await apiError(await page.request.get(path), 403)
  }
  expect(await data<AccountQuery>(await page.request.get(own))).toMatchObject({ saldo: '500.00', cuentaId: client('empresa60').accountId })
})

test('ADMIN rechaza cursor alterado y expirado, y permite reiniciar después de una revisión 409', async ({ page }) => {
  await login(page, fixture.admin)
  await adminAccounts(page)
  await expect(page.getByRole('button', { name: 'Siguiente página de cuentas' })).toBeVisible()
  const initial = await data<AccountList>(await page.request.get(adminList))
  const token = emittedCursor(initial.siguienteCursor)
  const [encoded, signature] = token.split('.') as [string, string]
  const tampered = encoded + '.' + (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1)
  await apiError(await page.request.get(nextPage(adminList, tampered)), 400, 'CONSULTA_INVALIDA')

  // Preserve scope, revision and TTL of the emitted token, but place its cut in the past.
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  const ttl = payload.exp - Date.parse(payload.corte)
  payload.exp = Date.now() - 60_000
  payload.corte = new Date(payload.exp - ttl).toISOString()
  const expired = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const key = process.env.FER19_E2E_CURSOR_KEY
  if (!key) throw Error('Falta la clave efímera del runner')
  const expiredToken = expired + '.' + createHmac('sha256', key).update(expired).digest('base64url')
  await apiError(await page.request.get(nextPage(adminList, expiredToken)), 409, 'CONSULTA_DESACTUALIZADA')

  await withOwnedDb(async connection => {
    const id = client('empresa30').accountId
    await connection.query('UPDATE CUENTA_CORRIENTE SET habilitada=0 WHERE id_cuenta_corriente=?', [id])
    try {
      const stale = page.waitForResponse(r => new URL(r.url()).pathname === adminList && r.url().includes('cursor='))
      await page.getByRole('button', { name: 'Siguiente página de cuentas' }).click()
      await apiError(await stale, 409, 'CONSULTA_DESACTUALIZADA')
      await expect(page.getByRole('alert')).toContainText('La consulta cambió o venció')
      await expect(page.getByRole('table')).toHaveCount(0)
    } finally {
      await connection.query('UPDATE CUENTA_CORRIENTE SET habilitada=1 WHERE id_cuenta_corriente=?', [id])
    }
  })
  await page.getByRole('button', { name: 'Reintentar desde la primera página' }).click()
  await expect(page.getByRole('table').first().locator('tbody tr')).toHaveCount(25)
})
