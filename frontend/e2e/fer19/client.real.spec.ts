import { expect, test, type Page } from '@playwright/test'
import type { CuentaCorrienteConsulta, CuentaCorrienteMovimiento, CuentaCorrienteResumen, CuentaCorrienteVencimiento } from '../../src/types/cuentaCorriente'
import { apiError, clientAccount, clientScreen, data, emittedCursor, fixture, login, logout, own, withOwnedDb } from './support'

type Slice<T> = { items: T[]; siguienteCursor: string | null; corte: string; revision: string }
const client = (key: string) => fixture.clients[key]!
const usd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD' })
const money = (value: string | null) => value === null ? 'No determinable' : usd.format(Number(value))

async function summary(page: Page, key: string, expected: Partial<CuentaCorrienteResumen>) {
  const result = await data<CuentaCorrienteConsulta>(await page.request.get(own))
  expect(result).toMatchObject({ cuentaId: client(key).accountId, origen: 'DEMO', moneda: 'USD', ...expected })
  if (result.estado === 'SIN_CUENTA') throw Error('Se esperaba una cuenta persistida')
  const cards = page.getByRole('region', { name: 'Resumen de la cuenta' })
  for (const [name, value] of [
    ['Saldo actual (USD)', result.saldo],
    ['Límite de crédito (USD)', result.limite],
    ['Crédito utilizado (USD)', result.utilizado],
    ['Crédito disponible (USD)', result.disponible],
  ] as const) {
    const card = cards.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
    await expect(card.getByText(money(value), { exact: true })).toBeVisible()
  }
  return result
}

test('CLIENTE A consulta saldo, movimientos y FIFO a 30 días y CLIENTE B recibe su cuenta a 60 días', async ({ page }) => {
  const a = client('empresa30'), b = client('empresa60')
  await login(page, a)
  await clientAccount(page)
  const first = await summary(page, 'empresa30', {
    saldo: '225.00', limite: '1000.00', utilizado: '225.00', disponible: '775.00', plazoDias: 30,
  })
  await expect(page.getByRole('note')).toContainText('Datos de demostración')
  const moves = await data<Slice<CuentaCorrienteMovimiento>>(await page.request.get(own + '/movimientos'))
  expect(moves.revision).toBe(first.revision)
  expect(moves.items.map(m => m.id)).toEqual([...a.movements].reverse().map(m => String(m.id)))
  expect(moves.items.map(m => [m.importe, m.saldoResultante, m.estado])).toEqual([
    ['7.00', '225.00', 'ANULADO'], ['125.00', '225.00', 'VIGENTE'], ['50.00', '350.00', 'VIGENTE'],
    ['200.00', '300.00', 'VIGENTE'], ['20.00', '100.00', 'ANULADO'], ['100.00', '100.00', 'VIGENTE'],
  ])
  const rows = page.getByRole('table').locator('tbody tr')
  await expect(rows).toHaveCount(moves.items.length)
  for (const [index, move] of moves.items.entries()) {
    const cells = rows.nth(index).getByRole('cell')
    await expect(cells.nth(1)).toContainText(move.concepto)
    await expect(cells.nth(3)).toHaveText(money(move.importe))
    await expect(cells.nth(5)).toHaveText(money(move.saldoResultante))
    await expect(cells.nth(6)).toHaveText(move.estado === 'ANULADO' ? 'Anulado' : 'Vigente')
  }
  const dues = await data<Slice<CuentaCorrienteVencimiento>>(await page.request.get(own + '/vencimientos'))
  expect(dues.items.map(d => [d.venceEl, d.plazoDias, d.pendiente])).toEqual([
    ['2026-03-03', 30, '175.00'], ['2026-04-01', 30, '50.00'],
  ])
  const due = page.getByRole('region', { name: 'Vencimientos', exact: true })
  for (const entry of dues.items) await expect(due).toContainText(money(entry.pendiente))
  await expect(due.getByText('Plazo 30 días', { exact: true })).toHaveCount(2)

  await logout(page)
  await apiError(await page.request.get(own), 401)
  await login(page, b)
  await clientAccount(page)
  await summary(page, 'empresa60', {
    saldo: '500.00', limite: '2000.00', utilizado: '500.00', disponible: '1500.00', plazoDias: 60,
  })
  const second = await data<Slice<CuentaCorrienteMovimiento>>(await page.request.get(own + '/movimientos'))
  expect(second.items.map(m => m.id)).toEqual([...b.movements].reverse().map(m => String(m.id)))
  await expect(rows).toHaveCount(2)
  await expect(page.getByRole('table')).not.toContainText(moves.items[0]!.concepto)
  const dueB = await data<Slice<CuentaCorrienteVencimiento>>(await page.request.get(own + '/vencimientos'))
  expect(dueB.items.map(d => [d.venceEl, d.plazoDias, d.pendiente])).toEqual([['2026-03-02', 60, '500.00']])
  await expect(due.getByText('Plazo 60 días', { exact: true })).toBeVisible()
  await expect(due).toContainText(money('500.00'))
})

test('CLIENTE pagina movimientos y vencimientos sin duplicar filas', async ({ page }) => {
  const c = client('paginada')
  await login(page, c)
  await clientAccount(page)
  await summary(page, 'paginada', { saldo: '27.00', limite: '1000.00', utilizado: '27.00', disponible: '973.00' })
  const rows = page.getByRole('table').locator('tbody tr')
  await expect(rows).toHaveCount(25)
  const first = await data<Slice<CuentaCorrienteMovimiento>>(await page.request.get(own + '/movimientos'))
  expect(first.items.map(m => m.id)).toEqual(c.movements.slice(2).reverse().map(m => String(m.id)))
  const readMore = page.waitForResponse(r => new URL(r.url()).pathname === own + '/movimientos' && r.url().includes('cursor='))
  await page.getByRole('button', { name: 'Ver más movimientos' }).click()
  const next = await data<Slice<CuentaCorrienteMovimiento>>(await readMore)
  expect(next.items.map(m => m.id)).toEqual(c.movements.slice(0, 2).reverse().map(m => String(m.id)))
  expect(next.revision).toBe(first.revision)
  await expect(rows).toHaveCount(27)
  await expect(rows.last()).toContainText('Pedido #' + c.movements[0]!.orderId)
  await expect(page.getByRole('button', { name: 'Ver más movimientos' })).toHaveCount(0)

  const dues = page.getByRole('region', { name: 'Vencimientos', exact: true })
  await expect(dues.getByRole('listitem')).toHaveCount(25)
  const firstDue = await data<Slice<CuentaCorrienteVencimiento>>(await page.request.get(own + '/vencimientos'))
  emittedCursor(firstDue.siguienteCursor)
  const moreDue = page.waitForResponse(r => new URL(r.url()).pathname === own + '/vencimientos' && r.url().includes('cursor='))
  await page.getByRole('button', { name: 'Ver más vencimientos' }).click()
  const nextDue = await data<Slice<CuentaCorrienteVencimiento>>(await moreDue)
  expect([...firstDue.items, ...nextDue.items].map(d => d.movimientoId)).toEqual(c.movements.map(m => String(m.id)))
  await expect(dues.getByRole('listitem')).toHaveCount(27)
})

for (const [key, expected, message] of [
  ['favor', { saldo: '-150.00', utilizado: '0.00', disponible: '100.00' }, 'No hay vencimientos pendientes.'],
  ['inhabilitada', { estado: 'INHABILITADA', saldo: '70.00', disponible: '0.00' }, 'La cuenta está inhabilitada.'],
  ['vacia', { saldo: '0.00', cobertura: 'COMPLETA', disponible: '300.00' }, 'No hay movimientos registrados en esta cuenta.'],
  ['parcial', { saldo: null, utilizado: null, disponible: null, cobertura: 'PARCIAL' }, 'La información es parcial'],
  ['incompleta', { saldo: null, limite: null, utilizado: null, disponible: null, cobertura: 'NO_ACREDITADA' }, 'No hay cobertura financiera acreditada'],
] as const) {
  test('CLIENTE muestra el escenario ' + key, async ({ page }) => {
    await login(page, client(key))
    await clientAccount(page)
    await summary(page, key, expected)
    await expect(page.getByText(message).first()).toBeVisible()
    if (key === 'parcial') await expect(page.getByRole('table')).toContainText('No determinable')
    if (key === 'inhabilitada') await expect(page.getByRole('table')).toContainText(money('70.00'))
  })
}

test('CLIENTE sin cuenta ve el estado SIN_CUENTA', async ({ page }) => {
  await login(page, client('empresa-sin-cuenta'))
  await clientAccount(page)
  expect(await data<CuentaCorrienteConsulta>(await page.request.get(own))).toMatchObject({ estado: 'SIN_CUENTA' })
  await expect(page.getByRole('status')).toContainText('No tenés una cuenta corriente asociada')
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('CLIENTE muestra carga mientras MariaDB está bloqueada y luego presenta la cuenta', async ({ page }) => {
  await login(page, client('empresa30'))
  await withOwnedDb(async connection => {
    await connection.query('LOCK TABLES CUENTA_CORRIENTE WRITE')
    try {
      await clientAccount(page)
      await expect(page.getByRole('status')).toContainText('Consultando la cuenta corriente')
      await expect(page.getByRole('region', { name: 'Resumen de la cuenta' })).toHaveCount(0)
    } finally {
      await connection.query('UNLOCK TABLES')
    }
  })
  await summary(page, 'empresa30', { saldo: '225.00' })
})

test('ADMIN recibe rechazo en las tres rutas propias y en la pantalla CLIENTE', async ({ page }) => {
  await login(page, fixture.admin)
  await page.goto(clientScreen)
  await expect(page).toHaveURL(/\/acceso-denegado$/)
  for (const path of [own, own + '/movimientos', own + '/vencimientos']) {
    await apiError(await page.request.get(path), 403)
  }
})
