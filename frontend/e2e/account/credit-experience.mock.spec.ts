import { expect, test, type Page } from '@playwright/test'

type Approval = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'
type Account = Record<string, unknown> | null

const revision = 'rev-354'

function summary(overrides: Record<string, unknown> = {}) {
  return {
    corte: '2026-11-24T12:00:00.000Z',
    revision,
    estado: 'HABILITADA',
    cuentaId: 9,
    origen: 'REAL',
    moneda: 'USD',
    plazoDias: 30,
    saldo: '120.00',
    limite: '600.00',
    utilizado: '120.00',
    disponible: '480.00',
    deudaVencidaTotal: '0.00',
    deudaVencida30Dias: '0.00',
    deudaVencida60Dias: '0.00',
    deudaPorVencerTotal: '120.00',
    cobertura: 'COMPLETA',
    estadoCredito: 'DISPONIBLE',
    ...overrides,
  }
}

function pageData(items: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return {
    corte: '2026-11-24T12:00:00.000Z',
    revision,
    estado: 'HABILITADA',
    cobertura: 'COMPLETA',
    items,
    siguienteCursor: null,
    ...overrides,
  }
}

function creditRequest(estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA') {
  return {
    id: 44,
    estado,
    montoSolicitado: '600.00',
    plazoDias: 30,
    moneda: 'USD',
    observaciones: null,
    fechaSolicitud: '2026-11-20T12:00:00.000Z',
    fechaResolucion: estado === 'PENDIENTE' ? null : '2026-11-21T12:00:00.000Z',
    limiteAutorizado: estado === 'APROBADA' ? '600.00' : null,
    plazoAutorizado: estado === 'APROBADA' ? 30 : null,
  }
}

type Scenario = { approval: Approval; account: Account; request?: ReturnType<typeof creditRequest> }

async function mockAccount(page: Page, current: () => Scenario) {
  await page.route('**/api/**', async route => {
    const state = current()
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/auth/login') {
      return route.fulfill({ json: { user: user() } })
    }
    if (path === '/api/auth/me') {
      return route.fulfill({ json: { user: user() } })
    }
    if (path === '/api/auth/logout') {
      return route.fulfill({ json: {} })
    }
    if (path === '/api/cuenta-corriente') {
      return route.fulfill({ json: { data: state.account ?? { estado: 'SIN_CUENTA', revision, corte: '2026-11-24T12:00:00.000Z' } } })
    }
    if (path === '/api/cuenta-corriente/solicitudes') {
      return route.fulfill({ json: { data: { items: state.request ? [state.request] : [], siguienteAntesDeId: null } } })
    }
    if (path === '/api/cuenta-corriente/movimientos') {
      return route.fulfill({ json: { data: pageData([]) } })
    }
    if (path === '/api/cuenta-corriente/vencimientos') {
      return route.fulfill({ json: { data: pageData([]) } })
    }
    if (path === '/api/cuenta-corriente/comprobantes') {
      return route.fulfill({ json: { data: { items: [], paginaSiguiente: null } } })
    }
    if (path === '/api/cuenta-corriente/pagos') {
      return route.fulfill({ json: { data: { items: [], paginaSiguiente: null } } })
    }
    return route.fulfill({ json: { data: { items: [], paginaSiguiente: null } } })
  })

  function user() {
    const state = current()
    return {
      id: 31,
      nombre: 'Empresa demo',
      email: 'empresa@example.test',
      rol: 'CLIENTE',
      tipo_cliente: 'EMPRESA',
      estadoAprobacionEmpresa: state.approval,
      cuentaCorrienteHabilitada: state.account?.estado === 'HABILITADA',
    }
  }
}

async function open(page: Page) {
  await page.goto('/mi-cuenta/cuenta-corriente')
  await expect(page.getByRole('heading', { name: 'Mi cuenta corriente', exact: true })).toBeVisible()
}

test('la portada contextual explica cada estado y ofrece la acción permitida', async ({ page }) => {
  let state: Scenario = { approval: 'PENDIENTE', account: null }
  await mockAccount(page, () => state)

  await open(page)
  await expect(page.getByRole('heading', { name: 'Tu empresa está pendiente de aprobación' })).toBeVisible()
  await expect(page.getByText('Crédito disponible (USD)')).toHaveCount(0)

  state = { approval: 'RECHAZADA', account: null }
  await open(page)
  await expect(page.getByRole('heading', { name: 'La aprobación de tu empresa fue rechazada' })).toBeVisible()

  state = { approval: 'APROBADA', account: null }
  await open(page)
  await expect(page.getByRole('heading', { name: 'Todavía no tenés una cuenta corriente' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Iniciar solicitud', exact: true })).toBeVisible()
  await expect(page.getByLabel('Monto solicitado (USD)')).toBeVisible()

  state = { approval: 'APROBADA', account: null, request: creditRequest('PENDIENTE') }
  await open(page)
  await expect(page.getByRole('heading', { name: 'Tu solicitud de crédito está en revisión' })).toBeVisible()

  state = {
    approval: 'APROBADA',
    account: summary({ estado: 'INHABILITADA', estadoCredito: 'BLOQUEADO', disponible: '0.00' }),
    request: creditRequest('APROBADA'),
  }
  await open(page)
  await expect(page.getByRole('heading', { name: 'Crédito aprobado, cuenta pendiente de habilitación' })).toBeVisible()
  await expect(page.getByText('La cuenta está inhabilitada.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Comprar con cuenta corriente', exact: true })).toHaveCount(0)

  state = { approval: 'APROBADA', account: summary() }
  await open(page)
  await expect(page.getByRole('heading', { name: 'Tu cuenta está habilitada y podés comprar a crédito' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Comprar con cuenta corriente', exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: /Uso del límite autorizado/ })).toBeVisible()

  state = { approval: 'APROBADA', account: summary({ estadoCredito: 'BLOQUEADO' }) }
  await open(page)
  await expect(page.getByRole('heading', { name: 'Tu cuenta está habilitada, pero la compra está bloqueada' })).toBeVisible()

  state = { approval: 'APROBADA', account: summary({ estado: 'INHABILITADA', estadoCredito: 'BLOQUEADO' }) }
  await open(page)
  await expect(page.getByRole('heading', { name: 'Tu cuenta corriente está inhabilitada' })).toBeVisible()
  await expect(page.getByText('La cuenta está inhabilitada.')).toBeVisible()
})

test('la experiencia de crédito no desborda y mantiene visible la acción en los seis anchos', async ({ page }) => {
  await mockAccount(page, () => ({ approval: 'APROBADA', account: summary() }))
  await open(page)
  for (const width of [320, 360, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('link', { name: 'Comprar con cuenta corriente', exact: true })).toBeVisible()
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
      `sin desborde a ${width} px`).toBe(true)
  }
})
