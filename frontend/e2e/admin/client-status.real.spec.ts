import { expect, test, type Page } from '@playwright/test'

const ids: Record<string, number> = JSON.parse(process.env.E2E_ADMIN_ACCOUNTS ?? '{}')
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}
async function company(page: Page) {
  const response = await page.request.get('/api/admin/clientes')
  expect(response.ok()).toBe(true)
  const clients = (await response.json()).data.clientes
  const client = clients.find((item: { id: number }) => item.id === ids.debt)
  expect(client).toBeTruthy()
  return { client, clients }
}

for (const width of [1280, 768, 360]) {
  test(`registro empresarial y crédito independientes a ${width}px`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: 850 })
    await login(page)
    const { client, clients } = await company(page)
    const path = `/api/admin/clientes/${client.id}/estado-empresa`
    expect((await page.request.patch(path, { headers: { Origin: new URL(page.url()).origin }, data: { estado: 'PENDIENTE' } })).ok()).toBe(true)
    const accountPath = `/api/admin/clientes/${client.id}/cuenta-corriente`
    const before = (await (await page.request.get(accountPath)).json()).data
    let mutations = 0
    page.on('request', request => {
      if (new URL(request.url()).pathname === path && request.method() === 'PATCH') mutations++
    })
    await page.goto('/admin/clientes')
    const row = page.getByRole('row').filter({ hasText: client.email })
    await expect(row.getByText('Pendiente', { exact: true })).toBeVisible()
    await expect(row.getByText('Cuenta habilitada', { exact: true })).toBeVisible()
    await expect(row.getByText('Datos de demostración', { exact: true })).toHaveCount(0)
    await expect(row.getByText('Crédito disponible según la cuenta', { exact: true })).toHaveCount(0)
    const individual = clients.find((item: { tipoCliente: string }) => item.tipoCliente === 'PARTICULAR')
    if (individual) {
      const individualRow = page.getByRole('row').filter({ hasText: individual.email })
      await expect(individualRow.getByRole('button', { name: /Aprobar|Rechazar/ })).toHaveCount(0)
      await expect(individualRow).toContainText('No aplica a particulares')
    }
    const detailButton = row.getByRole('button', { name: `Ver detalle de ${client.nombreRazonSocial}` })
    for (const badge of [row.locator('.company-badge'), row.locator('.credit-badge')]) {
      await expect(badge).toHaveCSS('width', '176px')
      await expect(badge).toHaveCSS('height', '28px')
      await expect(badge).toHaveCSS('font-size', '12px')
    }
    for (const action of ['Aprobar', 'Rechazar']) {
      const button = row.getByRole('button', { name: `${action} cuenta empresa de ${client.nombreRazonSocial}` })
      await expect(button).toHaveCSS('width', '88px')
      await expect(button).toHaveCSS('height', '44px')
      await expect(button).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    }
    const headers = page.getByRole('columnheader')
    const headerStyles = await headers.evaluateAll(elements => elements.map(element => {
      const style = element.ownerDocument.defaultView!.getComputedStyle(element)
      return { font: style.fontSize, weight: style.fontWeight, align: style.textAlign, vertical: style.verticalAlign }
    }))
    expect(new Set(headerStyles.map(style => JSON.stringify(style))).size).toBe(1)
    expect(headerStyles[0]).toEqual({ font: '12px', weight: '600', align: 'left', vertical: 'middle' })
    for (const button of [detailButton, row.getByRole('button', { name: `Aprobar cuenta empresa de ${client.nombreRazonSocial}` })]) {
      expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
      await expect(button).toHaveCSS('cursor', 'pointer')
    }
    await detailButton.click()
    const detail = page.getByRole('dialog', { name: 'Detalle del cliente' })
    await expect(detail).toContainText(client.email)
    await expect(detail).toContainText('Cuenta habilitada')
    for (const badge of [detail.locator('.company-badge'), detail.locator('.credit-badge')]) {
      await expect(badge).toHaveCSS('width', '176px')
      await expect(badge).toHaveCSS('height', '28px')
      expect(await badge.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element, '::before').width)).toBe('6px')
    }
    await expect(detail.getByRole('button', { name: /Confirmar/ })).toHaveCount(0)
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect(detail.locator('dl')).toHaveCSS('grid-template-columns', width === 360 ? /^\S+px$/ : /^\S+px \S+px$/)
    await page.screenshot({ path: test.info().outputPath(`cliente-detalle-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect(detailButton).toBeFocused()

    const approve = row.getByRole('button', { name: `Aprobar cuenta empresa de ${client.nombreRazonSocial}` })
    await approve.click()
    const dialog = page.getByRole('dialog', { name: 'Aprobar empresa' })
    await expect(dialog).toContainText('Esta acción no habilita crédito')
    await expect(dialog.getByRole('button', { name: 'Confirmar aprobación' })).toHaveCSS('background-color', 'rgb(20, 90, 141)')
    expect(mutations).toBe(0)
    await dialog.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    expect(mutations).toBe(0)
    await approve.click()
    await dialog.getByRole('button', { name: 'Confirmar aprobación' }).click()
    await expect(dialog.getByRole('status')).toContainText('Empresa aprobada.')
    expect(mutations).toBe(1)
    await dialog.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    await expect(row.getByText('Aprobada', { exact: true })).toBeVisible()
    await expect(approve).toHaveCount(0)
    await expect(detailButton).toBeFocused()
    await row.getByRole('button', { name: `Rechazar cuenta empresa de ${client.nombreRazonSocial}` }).click()
    const rejection = page.getByRole('dialog', { name: 'Rechazar empresa' })
    await expect(rejection).toContainText('No se eliminan la cuenta corriente ni su historial financiero')
    await expect(rejection.getByRole('button', { name: 'Confirmar rechazo' })).toHaveCSS('background-color', 'rgb(220, 38, 38)')
    await rejection.getByRole('button', { name: 'Confirmar rechazo' }).click()
    await expect(rejection.getByRole('status')).toContainText('Empresa rechazada.')
    await rejection.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    await expect(row.getByRole('button', { name: `Rechazar cuenta empresa de ${client.nombreRazonSocial}` })).toHaveCount(0)
    await expect(approve).toBeEnabled()
    await expect(detailButton).toBeFocused()
    await expect(row.getByText('Rechazada', { exact: true })).toBeVisible()
    await expect(row.getByText('Cuenta habilitada', { exact: true })).toBeVisible()
    const after = (await (await page.request.get(accountPath)).json()).data
    for (const field of ['estado', 'cuentaId', 'saldo', 'limite']) expect(after[field]).toEqual(before[field])
    await page.reload()
    await expect(row.getByText('Rechazada', { exact: true })).toBeVisible()
    await expect(row.getByText('Cuenta habilitada', { exact: true })).toBeVisible()
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`clientes-${width}.png`), fullPage: true })
  })
}

test('verifica una respuesta perdida y recupera una consulta de crédito fallida', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  const { client } = await company(page)
  const path = `/api/admin/clientes/${client.id}/estado-empresa`
  expect((await page.request.patch(path, { headers: { Origin: new URL(page.url()).origin }, data: { estado: 'PENDIENTE' } })).ok()).toBe(true)
  let failCredit = true
  await page.route(`**/api/admin/clientes/${client.id}/cuenta-corriente`, async route => {
    if (failCredit) await route.fulfill({ status: 503, json: { message: 'Consulta no disponible' } })
    else await route.continue()
  })
  await page.goto('/admin/clientes')
  const row = page.getByRole('row').filter({ hasText: client.email })
  await expect(row).toContainText('Crédito no disponible para consulta')
  await expect(row.getByText('Sin cuenta corriente', { exact: true })).toHaveCount(0)
  failCredit = false
  await row.getByRole('button', { name: 'Reintentar crédito' }).click()
  await expect(row).toContainText('Cuenta habilitada')

  let failRead = false
  let mutations = 0
  await page.route('**/api/admin/clientes', async route => {
    if (failRead) await route.fulfill({ status: 503, json: { message: 'Consulta no disponible' } })
    else await route.continue()
  })
  await page.route(`**${path}`, async route => {
    mutations++
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    failRead = true
    await route.abort('failed')
  })
  await row.getByRole('button', { name: `Aprobar cuenta empresa de ${client.nombreRazonSocial}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Aprobar empresa' })
  await dialog.getByRole('button', { name: 'Confirmar aprobación' }).click()
  await expect(dialog).toContainText('El resultado es incierto')
  await expect(dialog.getByRole('button', { name: 'Confirmar aprobación' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: `Aprobar cuenta empresa de ${client.nombreRazonSocial}` })).toBeDisabled()
  expect(mutations).toBe(1)
  failRead = false
  await dialog.getByRole('button', { name: 'Verificar estado actual' }).click()
  await expect(dialog.getByRole('status')).toContainText('Estado verificado con el servidor.')
  await expect(dialog).toContainText('Aprobada')
  expect(mutations).toBe(1)
})

test('un particular no puede consultar ni aprobar clientes desde ADMIN', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('cliente@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
  const path = `/api/admin/clientes/${ids.debt}/estado-empresa`
  expect((await page.request.get('/api/admin/clientes')).status()).toBe(403)
  expect((await page.request.patch(path, {
    headers: { Origin: new URL(page.url()).origin }, data: { estado: 'APROBADA' },
  })).status()).toBe(403)
  await page.goto('/admin/clientes')
  await expect(page).toHaveURL(/\/acceso-denegado$/)
  await expect(page.getByRole('region', { name: /Listado de clientes/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Aprobar cuenta empresa/ })).toHaveCount(0)
})
