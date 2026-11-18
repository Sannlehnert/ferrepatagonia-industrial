import { expect, test } from '@playwright/test'

for (const width of [390, 1280]) {
  test(`aprobación y crédito se consultan por separado a ${width}px`, async ({ page }) => {
    let approval: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' = 'PENDIENTE'
    let account: Record<string, unknown> = { estado: 'SIN_CUENTA', revision: '1', corte: '2026-01-01' }
    let failed = false
    let mismatched = false
    await page.setViewportSize({ width, height: 800 })
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
      id: 31, nombre: 'Empresa', email: 'empresa@example.test', rol: 'CLIENTE',
      tipo_cliente: 'EMPRESA', estadoAprobacionEmpresa: approval,
      cuentaCorrienteHabilitada: account.estado === 'SIN_CUENTA' ? null : account.estado === 'HABILITADA',
    } } }))
    await page.route('**/api/pedidos', route => route.fulfill({ json: { data: { items: [] } } }))
    await page.route('**/api/cuenta-corriente**', route => {
      if (failed) return route.fulfill({ status: 500, json: { message: 'Error' } })
      const path = new URL(route.request().url()).pathname
      return route.fulfill({ json: { data: path === '/api/cuenta-corriente' ? account : {
        estado: account.estado, revision: mismatched ? 'old' : account.revision, items: [], siguienteCursor: null,
      } } })
    })
    await page.goto('/mi-cuenta')
    const status = page.getByRole('region', { name: 'Estado comercial' })
    await expect(status).toContainText('aprobación de tu empresa está pendiente')
    await expect(status).toContainText('No tenés una cuenta corriente asociada')

    approval = 'APROBADA'
    account = { estado: 'HABILITADA', estadoCredito: 'BLOQUEADO', origen: 'REAL', revision: '2', corte: '2026-01-01' }
    await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
    await expect(status).toContainText('empresa está aprobada')
    await expect(status).toContainText('crédito está bloqueado')

    mismatched = true
    await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
    await expect(status).toContainText('No se pudo consultar el estado de la cuenta corriente')
    await expect(status).not.toContainText('crédito está bloqueado')
    mismatched = false

    account = { ...account, estadoCredito: 'NO_DETERMINABLE' }
    await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
    await expect(status).toContainText('estado del crédito no es determinable')

    account = { ...account, estado: 'INHABILITADA' }
    await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
    await expect(status).toContainText('cuenta corriente está inhabilitada')

    approval = 'RECHAZADA'
    account = { ...account, estado: 'HABILITADA', estadoCredito: 'BLOQUEADO' }
    await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
    await expect(status).toContainText('empresa fue rechazada')
    await expect(status).toContainText('crédito está bloqueado')

    failed = true
    await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
    await expect(status).toContainText('No se pudo consultar el estado de la cuenta corriente')
    await expect(status).not.toContainText('crédito está disponible')

    if (width < 768) await page.getByRole('button', { name: 'Menú de navegación de cuenta' }).click()
    const nav = page.getByRole('navigation', { name: 'Menú de mi cuenta' })
    await expect(nav.getByRole('link', { name: 'Cuenta corriente', exact: true })).toBeVisible()
  })
}

test('producción no muestra crédito calculado con movimientos de demostración', async ({ page }) => {
  test.skip(process.env.E2E_PRODUCTION_BUILD !== '1', 'Requiere build de producción.')
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
    id: 31, nombre: 'Empresa', email: 'empresa@example.test', rol: 'CLIENTE',
    tipo_cliente: 'EMPRESA', estadoAprobacionEmpresa: 'APROBADA', cuentaCorrienteHabilitada: true,
  } } }))
  await page.route('**/api/cuenta-corriente**', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ json: { data: path === '/api/cuenta-corriente'
      ? { estado: 'HABILITADA', estadoCredito: 'DISPONIBLE', origen: 'REAL', revision: 'r' }
      : { estado: 'HABILITADA', revision: 'r', items: [{ origen: 'DEMO' }] } } })
  })
  await page.goto('/mi-cuenta/cuenta-corriente')
  const status = page.getByRole('region', { name: 'Estado comercial' })
  await expect(status).toContainText('no se mostrará fuera del entorno de pruebas')
  await expect(status).not.toContainText('crédito está disponible')
})
