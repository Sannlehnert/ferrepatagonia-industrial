import { test, expect, type Page } from '@playwright/test'

// Financial DTOs intercepted: UI tests only. They do not certify the #260 integration.
const ctx = { corte: '2026-11-07T20:00:00.000Z', revision: 'demo-fixture' }
const account = (clienteId = 1) => ({ clienteId, cuentaId: clienteId, estado: 'INHABILITADA', origen: 'DEMO', moneda: 'USD', plazoDias: 60,
  saldo: null, limite: '1000.00', utilizado: null, disponible: '0.00', deudaVencidaTotal: null,
  deudaVencida30Dias: null, deudaVencida60Dias: null, deudaPorVencerTotal: null, cobertura: 'NO_ACREDITADA', estadoCredito: 'BLOQUEADO' })
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}
async function fixture(page: Page, options: { error?: number; mismatch?: boolean; empty?: boolean; absent?: boolean } = {}) {
  const urls: string[] = []
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.includes('cuenta')) return route.continue()
    urls.push(url.pathname + url.search)
    if (options.error) return route.fulfill({ status: options.error, json: { code: 'CONSULTA_DESACTUALIZADA' } })
    let data: object
    if (url.pathname === '/api/admin/cuentas-corrientes') {
      const next = url.searchParams.has('cursor')
      data = { ...ctx, items: options.empty ? [] : [account(next ? 3 : 1), ...next ? [] : [account(2)]], siguienteCursor: options.empty || next ? null : 'demo-list-next' }
    } else if (options.absent) data = { ...ctx, estado: 'SIN_CUENTA' }
    else if (url.pathname.endsWith('/movimientos')) data = { ...ctx, estado: 'INHABILITADA', cobertura: 'PARCIAL', items: options.empty ? [] : [{
      id: url.searchParams.has('cursor') ? '2' : '1', fechaOperacion: '2026-10-01T15:00:00.000Z', concepto: 'Cargo de prueba', tipo: 'CARGO', importe: '125.00',
      saldoResultante: null, moneda: 'USD', estado: 'ANULADO', referencia: { pedidoId: 1 }, plazoDias: 30, venceEl: '2026-10-31', origen: 'DEMO',
    }], siguienteCursor: options.empty || url.searchParams.has('cursor') ? null : 'demo-movements-next' }
    else if (url.pathname.endsWith('/vencimientos')) data = { ...ctx, revision: options.mismatch ? 'different' : ctx.revision,
      estado: 'INHABILITADA', cobertura: 'PARCIAL', items: options.empty ? [] : [{ movimientoId: '3', venceEl: '2026-11-07', plazoDias: 60,
        moneda: 'USD', pendiente: null, estado: 'NO_DETERMINABLE', origen: 'DEMO' }], siguienteCursor: null }
    else data = { ...ctx, ...account() }
    return route.fulfill({ json: { data } })
  })
  return urls
}

for (const width of [1280, 360]) {
  test.describe(`consultas UI interceptadas ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })
    test('filtros, nulos, cuenta inhabilitada, histórico y páginas', async ({ page }) => {
      await login(page)
      const urls = await fixture(page)
      await page.goto('/admin/cuentas-corrientes')
      await expect(page.getByRole('button', { name: 'Consultar cliente 1', exact: true })).toBeVisible()
      await page.getByLabel('ID de cliente', { exact: true }).fill('2')
      await page.getByRole('combobox', { name: 'Habilitación', exact: true }).selectOption('false')
      await page.getByRole('button', { name: 'Aplicar filtros' }).click()
      await expect.poll(() => urls.at(-1)).toContain('habilitada=false')
      expect(urls.at(-1)).toContain('clienteId=2')
      await page.getByRole('button', { name: 'Consultar cliente 1', exact: true }).click()
      await expect(page.getByText('Cuenta inhabilitada. El historial sigue disponible para consulta.')).toBeVisible()
      await expect(page.getByText('Datos DEMO ·', { exact: true })).toBeVisible()
      await expect(page.getByText('No acreditado', { exact: true }).first()).toBeVisible()
      await expect(page.getByRole('region', { name: 'Movimientos', exact: true })).toContainText('CARGO / ANULADO')
      await expect(page.getByRole('region', { name: 'Vencimientos', exact: true })).toContainText('NO_DETERMINABLE')
      await page.screenshot({ path: test.info().outputPath('accounts-detail.png'), fullPage: true })
      await page.getByRole('button', { name: 'Siguiente página de movimientos' }).click()
      await expect.poll(() => urls.some(url => url.includes('cursor=demo-movements-next'))).toBe(true)
      await expect(page.getByRole('button', { name: 'Siguiente página de movimientos' })).toHaveCount(0)
      await page.getByRole('button', { name: 'Siguiente página de cuentas' }).click()
      await expect(page.getByRole('button', { name: 'Consultar cliente 3', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Cliente 1', exact: true })).toHaveCount(0)
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    })
  })
}
test('UI interceptada: 409 limpia datos y permite reiniciar; error no se vuelve vacío', async ({ page }) => {
  await login(page)
  const options = { error: 409 }
  await fixture(page, options)
  await page.goto('/admin/cuentas-corrientes')
  await expect(page.getByRole('alert')).toContainText('Reiniciá desde la primera página')
  await expect(page.getByText('No hay cuentas para estos filtros.')).toHaveCount(0)
  options.error = 0
  await page.getByRole('button', { name: 'Reintentar desde la primera página' }).click()
  await expect(page.getByRole('button', { name: 'Consultar cliente 1', exact: true })).toBeVisible()
})
test('UI interceptada: revisiones incompatibles no presentan detalle confirmado', async ({ page }) => {
  await login(page); await fixture(page, { mismatch: true }); await page.goto('/admin/cuentas-corrientes')
  await page.getByRole('button', { name: 'Consultar cliente 1', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Reiniciá desde la primera página')
  await expect(page.getByText('Datos DEMO ·', { exact: true })).toHaveCount(0)
})
test('UI interceptada: lista vacía y consulta directa SIN_CUENTA', async ({ page }) => {
  await login(page); await fixture(page, { empty: true, absent: true }); await page.goto('/admin/cuentas-corrientes')
  await expect(page.getByText('No hay cuentas para estos filtros.')).toBeVisible()
  await page.getByLabel('ID de cliente', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Consultar cliente por ID' }).click()
  await expect(page.getByText('El cliente no tiene cuenta corriente asignada.')).toBeVisible()
})
test('UI interceptada: cobertura insuficiente no equivale a vacío completo', async ({ page }) => {
  await login(page); await fixture(page, { empty: true }); await page.goto('/admin/cuentas-corrientes')
  await page.getByLabel('ID de cliente', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Consultar cliente por ID' }).click()
  await expect(page.getByText('Sin movimientos acreditados para mostrar. La información es incompleta.')).toBeVisible()
  await expect(page.getByText('Sin fechas acreditadas para mostrar.')).toBeVisible()
})
