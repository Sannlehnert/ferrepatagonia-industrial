import { expect, test, type Page } from '@playwright/test'

interface AdminClient {
  id: number
  email: string
  nombreRazonSocial: string
  tipoCliente: string
}

const ids: Record<string, number> = JSON.parse(process.env.E2E_ADMIN_ACCOUNTS ?? '{}')
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}
async function openClients(page: Page, busqueda?: string) {
  const query = busqueda ? `?busqueda=${encodeURIComponent(busqueda)}` : ''
  await page.goto(`/admin/clientes${query}`)
}
async function setApproval(page: Page, path: string, estado: string) {
  return page.request.patch(path, { headers: { Origin: new URL(page.url()).origin }, data: { estado } })
}
async function company(page: Page) {
  const response = await page.request.get('/api/admin/clientes')
  expect(response.ok()).toBe(true)
  const clients = (await response.json()).data.clientes as AdminClient[]
  const client = clients.find(item => item.id === ids.debt)
  expect(client).toBeTruthy()
  return { client: client!, clients }
}

for (const width of [1280, 768, 360]) {
  test(`registro empresarial y crédito independientes a ${width}px`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: 850 })
    await login(page)
    const { client, clients } = await company(page)
    const path = `/api/admin/clientes/${client.id}/estado-empresa`
    expect((await setApproval(page, path, 'PENDIENTE')).ok()).toBe(true)
    const accountPath = `/api/admin/clientes/${client.id}/cuenta-corriente`
    const before = (await (await page.request.get(accountPath)).json()).data
    let mutations = 0
    page.on('request', request => {
      if (new URL(request.url()).pathname === path && request.method() === 'PATCH') mutations++
    })
    await openClients(page, client.email)
    const row = page.getByRole('row').filter({ hasText: client.email })
    await expect(row.getByText('Pendiente', { exact: true })).toBeVisible()
    await expect(row.getByText('Cuenta habilitada', { exact: true })).toBeVisible()
    await expect(row.getByText('Datos de demostración', { exact: true })).toHaveCount(0)
    await expect(row.getByText('Crédito disponible según la cuenta', { exact: true })).toHaveCount(0)
    const individual = clients.find((item: { tipoCliente: string }) => item.tipoCliente === 'PARTICULAR')
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
    await expect(dialog.getByRole('status').filter({ hasText: 'Empresa aprobada.' })).toBeVisible()
    expect(mutations).toBe(1)
    await dialog.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    await expect(row.getByText('Aprobada', { exact: true })).toBeVisible()
    await expect(approve).toHaveCount(0)
    await expect(detailButton).toBeFocused()
    expect((await (await page.request.get(accountPath)).json()).data.estadoCredito).toBe('DISPONIBLE')
    await expect(row.getByText('Crédito disponible', { exact: true })).toBeVisible()
    await expect(row.getByText('Datos de demostración', { exact: true })).toHaveCount(0)
    await row.getByRole('button', { name: `Rechazar cuenta empresa de ${client.nombreRazonSocial}` }).click()
    const rejection = page.getByRole('dialog', { name: 'Rechazar empresa' })
    await expect(rejection).toContainText('No se eliminan la cuenta corriente ni su historial financiero')
    await expect(rejection.getByRole('button', { name: 'Confirmar rechazo' })).toHaveCSS('background-color', 'rgb(220, 38, 38)')
    await rejection.getByRole('button', { name: 'Confirmar rechazo' }).click()
    await expect(rejection.getByRole('status').filter({ hasText: 'Empresa rechazada.' })).toBeVisible()
    await rejection.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    await expect(row.getByRole('button', { name: `Rechazar cuenta empresa de ${client.nombreRazonSocial}` })).toHaveCount(0)
    await expect(approve).toBeEnabled()
    await expect(detailButton).toBeFocused()
    await expect(row.getByText('Rechazada', { exact: true })).toBeVisible()
    await expect(row.getByText('Cuenta habilitada', { exact: true })).toBeVisible()
    await expect(row.getByText('Crédito bloqueado', { exact: true })).toBeVisible()
    const after = (await (await page.request.get(accountPath)).json()).data
    for (const field of ['estado', 'cuentaId', 'saldo', 'limite']) expect(after[field]).toEqual(before[field])
    await openClients(page, client.email)
    await page.reload()
    await expect(row.getByText('Rechazada', { exact: true })).toBeVisible()
    await expect(row.getByText('Cuenta habilitada', { exact: true })).toBeVisible()
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`clientes-${width}.png`), fullPage: true })
    if (individual) {
      await openClients(page, individual.email)
      const individualRow = page.getByRole('row').filter({ hasText: individual.email })
      await expect(individualRow.getByRole('button', { name: /Aprobar|Rechazar/ })).toHaveCount(0)
      await expect(individualRow).toContainText('No aplica a particulares')
    }
  })
}

test('verifica una respuesta perdida y recupera una consulta de crédito fallida', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  const { client } = await company(page)
  const path = `/api/admin/clientes/${client.id}/estado-empresa`
  expect((await setApproval(page, path, 'PENDIENTE')).ok()).toBe(true)
  let failCredit = true
  await page.route(`**/api/admin/clientes/${client.id}/cuenta-corriente`, async route => {
    if (failCredit) await route.fulfill({ status: 503, json: { message: 'Consulta no disponible' } })
    else await route.continue()
  })
  await openClients(page, client.email)
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
  await expect(dialog.getByRole('status').filter({ hasText: 'Estado verificado con el servidor.' })).toBeVisible()
  await expect(dialog).toContainText('Aprobada')
  expect(mutations).toBe(1)
})

test('cada empresa publica su crédito y permite reintentar aunque otra consulta no responda', async ({ page }) => {
  test.setTimeout(45_000)
  await login(page)
  const { clients } = await company(page)
  const group = clients.filter(item => item.tipoCliente === 'EMPRESA'
    && item.email.startsWith('cc258-page-1'))
  expect(group.length).toBeGreaterThanOrEqual(3)
  const [slow, failed, healthy] = group
  const row = (client: { email: string }) => page.getByRole('row').filter({ hasText: client.email })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let slowReads = 0, failedReads = 0, fail = true
  await page.route(`**/api/admin/clientes/${slow.id}/cuenta-corriente`, async route => {
    slowReads++
    const response = await route.fetch()
    if (slowReads === 1) await held
    await route.fulfill({ response })
  })
  await page.route(`**/api/admin/clientes/${failed.id}/cuenta-corriente`, async route => {
    failedReads++
    if (fail) await route.fulfill({ status: 503, json: {} })
    else await route.continue()
  })
  const accountLabel = /Cuenta\s+(?:habilitada|inhabilitada)|Sin cuenta corriente/
  try {
    await openClients(page, 'cc258-page-1')
    await expect(row(slow).getByText('Consultando crédito…', { exact: true })).toBeVisible()
    await expect(row(failed).getByRole('button', { name: 'Reintentar crédito' })).toBeVisible()
    await expect(row(healthy).getByText(accountLabel)).toBeVisible()
    fail = false
    await row(failed).getByRole('button', { name: 'Reintentar crédito' }).click()
    await expect(row(failed).getByText(accountLabel)).toBeVisible()
    expect(failedReads).toBe(2)
    expect(slowReads).toBe(1)
    await expect(row(slow).getByRole('button', { name: 'Reintentar crédito' })).toBeVisible({ timeout: 20_000 })
    release()
    await row(slow).getByRole('button', { name: 'Reintentar crédito' }).click()
    await expect(row(slow).getByText(accountLabel)).toBeVisible()
    expect(slowReads).toBe(2)
    expect(failedReads).toBe(2)
  } finally { release() }
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

test('estadoEsperado rechaza una aprobación retenida si se confirmó otro estado tras recargar', async ({ page }) => {
  test.setTimeout(50_000)
  await login(page)
  const { client } = await company(page)
  const path = `/api/admin/clientes/${client.id}/estado-empresa`
  expect((await setApproval(page,path,'PENDIENTE')).ok()).toBe(true)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let finish!: (status: number) => void
  const finished = new Promise<number>(resolve => { finish = resolve })
  let first = true
  await page.route('**'+path, async route => {
    if (!first) return route.continue()
    first = false
    await held
    const response = await route.fetch()
    finish(response.status())
    await route.fulfill({ response }).catch(() => {})
  })
  try {
    await openClients(page, client.email)
    const row = page.getByRole('row').filter({hasText:client.email})
    await row.getByRole('button',{name: 'Aprobar cuenta empresa de '+client.nombreRazonSocial}).click()
    await page.getByRole('button',{name:'Confirmar aprobación'}).click()
    await expect(page.getByRole('dialog').getByRole('status').filter({ hasText: 'Estado verificado con el servidor.' })).toBeVisible({ timeout: 20_000 })
    await page.reload()
    await row.getByRole('button',{name:'Rechazar cuenta empresa de '+client.nombreRazonSocial}).click()
    await page.getByRole('button',{name:'Confirmar rechazo'}).click()
    await expect(page.getByRole('dialog').getByRole('status').filter({ hasText: 'Empresa rechazada.' })).toBeVisible()
    release()
    expect(await finished).toBe(409)
    const fresh=(await (await page.request.get('/api/admin/clientes')).json()).data.clientes.find((c:{id:number})=>c.id===client.id)
    expect(fresh.estadoAprobacionEmpresa).toBe('RECHAZADA')
    await expect(row.locator('.company-badge')).toHaveText('Rechazada')
  } finally { release() }
})

test('S7-345-06: fallo antes del backend se recupera verificando y permite decidir de nuevo',async ({page})=>{
  await login(page)
  const {client}=await company(page)
  const path=`/api/admin/clientes/${client.id}/estado-empresa`
  expect((await setApproval(page,path,'PENDIENTE')).ok()).toBe(true)
  let fail=true,mutations=0
  await page.route('**'+path,async route=>{
    mutations++
    if(fail) await route.fulfill({status:503,json:{message:'No disponible'}})
    else await route.continue()
  })
  await openClients(page, client.email)
  const row=page.getByRole('row').filter({hasText:client.email})
  await row.getByRole('button',{name:'Aprobar cuenta empresa de '+client.nombreRazonSocial}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByRole('button',{name:'Confirmar aprobación'}).click()
  await expect(dialog.getByRole('status').filter({ hasText: 'Estado verificado con el servidor.' })).toBeVisible()
  await expect(dialog.locator('.company-badge')).toHaveText('Pendiente')
  fail=false
  await dialog.getByRole('button',{name:'Confirmar aprobación'}).click()
  await expect(dialog.getByRole('status').filter({ hasText: 'Empresa aprobada.' })).toBeVisible()
  expect(mutations).toBe(2)
})

test('S7-345-03: una verificación sin respuesta vence y permite cerrar y reintentar', async ({ page }) => {
  test.setTimeout(50_000)
  await login(page)
  const { client } = await company(page)
  const path = `/api/admin/clientes/${client.id}/estado-empresa`
  expect((await setApproval(page, path, 'PENDIENTE')).ok()).toBe(true)
  let holdRead = false, mutations = 0
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/admin/clientes', async route => {
    if (holdRead) await held
    await route.continue().catch(() => {})
  })
  await page.route(`**${path}`, async route => {
    mutations++
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    holdRead = true
    await route.abort('failed')
  })
  try {
    await openClients(page, client.email)
    const row = page.getByRole('row').filter({ hasText: client.email })
    await row.getByRole('button', { name: `Aprobar cuenta empresa de ${client.nombreRazonSocial}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Aprobar empresa' })
    await dialog.getByRole('button', { name: 'Confirmar aprobación' }).click()
    await expect(dialog.getByRole('button', { name: 'Cerrar detalle del cliente' })).toBeEnabled({ timeout: 20_000 })
    await expect(dialog).toContainText('No pudimos verificar el estado con el servidor')
    await dialog.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    await expect(dialog).toHaveCount(0)
    holdRead = false
    release()
    await row.getByRole('button', { name: `Reintentar verificación de cuenta empresa de ${client.nombreRazonSocial}` }).click()
    await expect(row.getByText('Aprobada', { exact: true })).toBeVisible()
    expect(mutations).toBe(1)
  } finally { release() }
})

test('S7-345-04: aprobar una fila no borra ni reinicia el crédito ya visible de las demás', async ({ page }) => {
  test.setTimeout(40_000)
  await login(page)
  const { clients } = await company(page)
  const companies = clients.filter(client => client.tipoCliente === 'EMPRESA'
    && client.email.startsWith('cc258-page-1'))
  expect(companies.length).toBeGreaterThanOrEqual(3)
  const target = companies[0]
  const path = `/api/admin/clientes/${target.id}/estado-empresa`
  expect((await setApproval(page, path, 'PENDIENTE')).ok()).toBe(true)
  let afterChange = false
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const reads = new Map<number, number>()
  await page.route('**/api/admin/clientes/*/cuenta-corriente', async route => {
    const id = Number(new URL(route.request().url()).pathname.split('/')[4])
    reads.set(id, (reads.get(id) ?? 0) + 1)
    const response = await route.fetch()
    if (afterChange) await held
    await route.fulfill({ response }).catch(() => {})
  })
  const row = (client: { email: string }) => page.getByRole('row').filter({ hasText: client.email })
  const accountLabel = /Cuenta\s+(?:habilitada|inhabilitada)|Sin cuenta corriente/
  try {
    await openClients(page, 'cc258-page-1')
    for (const client of companies) await expect(row(client).getByText(accountLabel)).toBeVisible()
    await expect(page.getByText('Consultando crédito…', { exact: true })).toHaveCount(0)
    const before = new Map(reads)
    afterChange = true
    await row(target).getByRole('button', { name: `Aprobar cuenta empresa de ${target.nombreRazonSocial}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Aprobar empresa' })
    await dialog.getByRole('button', { name: 'Confirmar aprobación' }).click()
    await expect(dialog.getByRole('status').filter({ hasText: 'Empresa aprobada.' })).toBeVisible()
    await expect.poll(() => reads.get(target.id)).toBe((before.get(target.id) ?? 0) + 1)
    await dialog.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    for (const client of companies.filter((item: { id: number }) => item.id !== target.id)) {
      await expect(row(client).getByText(accountLabel)).toBeVisible()
      await expect(row(client).getByText('Consultando crédito…', { exact: true })).toHaveCount(0)
      expect(reads.get(client.id)).toBe(before.get(client.id))
    }
    release()
    await expect(row(target).getByText(accountLabel)).toBeVisible()
  } finally { release() }
})
