import { expect, test, type Locator, type Page } from '@playwright/test'

type ClientType = 'PARTICULAR' | 'EMPRESA'
type Approval = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'
type AccountState = 'SIN_CUENTA' | 'HABILITADA' | 'INHABILITADA'
type CreditState = 'DISPONIBLE' | 'BLOQUEADO' | 'NO_DETERMINABLE'

type Receipt = {
  id: string
  pedidoId: number | null
  cuentaCorrienteId: number | null
  tipoMime: 'application/pdf' | 'image/jpeg' | 'image/png'
  bytes: number
  fecha: string
  estadoRevision: 'PENDIENTE' | 'REVISADO'
  revisadoEn: string | null
}

type MockState = {
  approval: Approval
  account: AccountState
  credit: CreditState
  receipts: Receipt[]
  receiptsError: boolean
  detailError: boolean
  uploadFails: boolean
  failAccount: boolean
}

function createState(tipo: ClientType): MockState {
  return {
    approval: tipo === 'EMPRESA' ? 'APROBADA' : 'APROBADA',
    account: tipo === 'EMPRESA' ? 'HABILITADA' : 'SIN_CUENTA',
    credit: 'DISPONIBLE',
    receipts: [],
    receiptsError: false,
    detailError: false,
    uploadFails: false,
    failAccount: false,
  }
}

function orderFor(tipo: ClientType) {
  return {
    pedidoId: 1,
    numero: 'PED-000001',
    fecha: '2026-11-16T12:00:00.000Z',
    estado: 'CONFIRMADO',
    modalidadPago: tipo === 'EMPRESA' ? 'CUENTA_CORRIENTE' : 'TRANSFERENCIA',
    moneda: 'USD',
    subtotal: '20.00',
    descuento: '0.00',
    total: '20.00',
    totalUSD: '20.00',
    cantidadLineas: 1,
    cantidadUnidades: 2,
  }
}

function receipt(id: string, estadoRevision: 'PENDIENTE' | 'REVISADO'): Receipt {
  return {
    id,
    pedidoId: 1,
    cuentaCorrienteId: null,
    tipoMime: 'image/png',
    bytes: 12,
    fecha: '2026-11-16T12:00:00.000Z',
    estadoRevision,
    revisadoEn: estadoRevision === 'REVISADO' ? '2026-11-16T13:00:00.000Z' : null,
  }
}

async function mockAccountApi(page: Page, tipo: ClientType, state: MockState) {
  const user = () => ({
    id: 1,
    nombre: 'Cliente de prueba',
    email: 'cliente@example.test',
    rol: 'CLIENTE',
    tipo_cliente: tipo,
    estadoAprobacionEmpresa: tipo === 'EMPRESA' ? state.approval : null,
    cuentaCorrienteHabilitada: tipo === 'EMPRESA' ? state.account !== 'SIN_CUENTA' : null,
  })
  let authenticated = true
  const order = orderFor(tipo)

  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/login') {
      authenticated = true
      return route.fulfill({ json: { user: user() } })
    }
    if (path === '/api/auth/me') {
      return authenticated
        ? route.fulfill({ json: { user: user() } })
        : route.fulfill({ status: 401, json: {} })
    }
    if (path === '/api/auth/logout') {
      authenticated = false
      return route.fulfill({ json: {} })
    }
    if (path === '/api/categorias') return route.fulfill({ json: { data: { categorias: [] } } })
    if (path === '/api/catalogo') return route.fulfill({ json: { data: {
      productos: [],
      pagination: { page: 1, limit: 12, total: 0, totalPages: 0, hasNext: false, hasPrevious: false },
    } } })
    if (path === '/api/pedidos') return route.fulfill({ json: { data: { items: [order] } } })
    if (path === '/api/pedidos/1') {
      return state.detailError
        ? route.fulfill({ status: 500, json: { message: 'No disponible' } })
        : route.fulfill({ json: { data: { ...order, items: [] } } })
    }
    if (path === '/api/pedidos/1/comprobantes') {
      if (route.request().method() === 'POST') {
        return state.uploadFails
          ? route.fulfill({ status: 500, json: { message: 'No disponible' } })
          : route.fulfill({ status: 201, json: {} })
      }
      return state.receiptsError
        ? route.fulfill({ status: 500, json: { message: 'No disponible' } })
        : route.fulfill({ json: { data: { items: state.receipts, paginaSiguiente: null } } })
    }
    if (path === '/api/cuenta-corriente') {
      if (state.failAccount) return route.fulfill({ status: 500, json: { message: 'No disponible' } })
      if (state.account === 'SIN_CUENTA') {
        return route.fulfill({ json: { data: { estado: 'SIN_CUENTA' } } })
      }
      return route.fulfill({ json: { data: {
        estado: state.account,
        cuentaId: 1,
        origen: 'REAL',
        moneda: 'USD',
        plazoDias: 30,
        saldo: '0.00',
        limite: '1000.00',
        utilizado: '0.00',
        disponible: '1000.00',
        deudaVencidaTotal: '0.00',
        deudaVencida30Dias: '0.00',
        deudaVencida60Dias: '0.00',
        deudaPorVencerTotal: '0.00',
        cobertura: 'COMPLETA',
        estadoCredito: state.credit,
        revision: '1',
        corte: '2026-01-01',
      } } })
    }
    if (path === '/api/cuenta-corriente/movimientos' || path === '/api/cuenta-corriente/vencimientos') {
      return route.fulfill({ json: { data: {
        estado: state.account === 'SIN_CUENTA' ? 'SIN_CUENTA' : state.account,
        revision: '1',
        cobertura: 'COMPLETA',
        items: [],
        siguienteCursor: null,
      } } })
    }
    return route.fulfill({ json: { data: { items: [], totalPages: 0 } } })
  })
}

async function openMenuIfNeeded(page: Page, width: number) {
  if (width < 768) {
    await page.getByRole('button', { name: 'Menú de navegación de cuenta' }).click()
  }
}

type ControlMetrics = {
  backgroundColor: string
  borderTopWidth: number
  borderTopStyle: string
  boxSizing: string
  cursor: string
  fontFamily: string
  fontSize: string
  width: number
  height: number
}

async function controlMetrics(locator: Locator): Promise<ControlMetrics> {
  await expect(locator).toBeVisible()
  return locator.evaluate(element => {
    const style = element.ownerDocument.defaultView.getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: Number.parseFloat(style.borderTopWidth),
      borderTopStyle: style.borderTopStyle,
      boxSizing: style.boxSizing,
      cursor: style.cursor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      width: box.width,
      height: box.height,
    }
  })
}

async function expectTouchTarget(locator: Locator) {
  const metrics = await controlMetrics(locator)
  expect(metrics.height).toBeGreaterThanOrEqual(44)
  expect(metrics.width).toBeGreaterThanOrEqual(44)
}

async function expectTextButton(locator: Locator) {
  const metrics = await controlMetrics(locator)
  expect(metrics.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(metrics.borderTopWidth).toBe(0)
  expect(metrics.boxSizing).toBe('border-box')
  expect(metrics.cursor).toBe('pointer')
  expect(metrics.fontFamily.toLowerCase()).toContain('arial')
  const hasText = await locator.evaluate(element => (element.textContent ?? '').trim().length > 0)
  if (hasText) expect(metrics.fontSize).not.toBe('13.3333px')
  expect(metrics.height).toBeGreaterThanOrEqual(44)
  expect(metrics.width).toBeGreaterThanOrEqual(44)
}

async function expectBorderedButton(
  locator: Locator,
  backgroundColor: 'white' | 'transparent',
) {
  const metrics = await controlMetrics(locator)
  const details = await locator.evaluate(element => ({
    tag: element.tagName,
    classes: element.className,
    text: element.textContent,
  }))
  expect(metrics.backgroundColor, JSON.stringify(details)).toBe(
    backgroundColor === 'white' ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0)',
  )
  expect(metrics.borderTopWidth, JSON.stringify(details)).toBeGreaterThanOrEqual(1)
  expect(metrics.borderTopStyle).toBe('solid')
  expect(metrics.boxSizing).toBe('border-box')
  expect(metrics.cursor).toBe('pointer')
  expect(metrics.fontFamily.toLowerCase()).toContain('arial')
  expect(metrics.height).toBeGreaterThanOrEqual(44)
  expect(metrics.width).toBeGreaterThanOrEqual(44)
}

async function expectSelector(locator: Locator) {
  const metrics = await controlMetrics(locator)
  expect(metrics.backgroundColor).toBe('rgb(255, 255, 255)')
  expect(metrics.borderTopWidth).toBeGreaterThanOrEqual(1)
  expect(metrics.borderTopStyle).toBe('solid')
  expect(metrics.boxSizing).toBe('border-box')
  expect(metrics.fontFamily.toLowerCase()).toContain('arial')
  expect(metrics.height).toBeGreaterThanOrEqual(44)
}

async function expectFocusOutline(
  page: Page,
  locator: Locator,
  color = 'rgb(20, 90, 141)',
) {
  await locator.evaluate(element => {
    const active = element.ownerDocument.activeElement
    if (active && typeof active.blur === 'function') active.blur()
  })
  let focused = false
  for (let index = 0; index < 400; index += 1) {
    await page.keyboard.press('Tab')
    focused = await locator.evaluate(element => element === element.ownerDocument.activeElement)
    if (focused) break
  }
  expect(focused, 'El control debe ser alcanzable con Tab').toBe(true)
  const readOutline = () => locator.evaluate(element => {
    const style = element.ownerDocument.defaultView.getComputedStyle(element)
    return {
      width: Number.parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      color: style.outlineColor,
      offset: Number.parseFloat(style.outlineOffset),
    }
  })
  await expect.poll(async () => (await readOutline()).color).toBe(color)
  const outline = await readOutline()
  expect(outline.width).toBeGreaterThanOrEqual(2)
  expect(outline.style).toBe('solid')
  expect(outline.offset).toBeGreaterThanOrEqual(0)
}

async function contrastRatio(locator: Locator): Promise<number> {
  const colors = await locator.evaluate(element => {
    function parse(value: string) {
      const match = value.match(/rgba?\(([^)]+)\)/)
      if (!match) return { r: 0, g: 0, b: 0, a: 0 }
      const parts = match[1]!.split(',').map(part => Number.parseFloat(part.trim()))
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 }
    }
    function composite(top: ReturnType<typeof parse>, bottom: ReturnType<typeof parse>) {
      const alpha = top.a + bottom.a * (1 - top.a)
      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        a: alpha,
      }
    }
    function luminance(color: ReturnType<typeof parse>) {
      const channel = (value: number) => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    }
    const layers: ReturnType<typeof parse>[] = []
    const view = element.ownerDocument.defaultView
    let node = element
    while (node) {
      const background = parse(view.getComputedStyle(node).backgroundColor)
      if (background.a > 0) layers.push(background)
      node = node.parentElement
    }
    let background = { r: 255, g: 255, b: 255, a: 1 }
    for (const layer of layers.reverse()) background = composite(layer, background)
    return { text: parse(view.getComputedStyle(element).color), background }
  })
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const luminance = (color: { r: number; g: number; b: number }) =>
    0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
  const foreground = luminance(colors.text)
  const background = luminance(colors.background)
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
}

async function expectContrast(locator: Locator, minimum = 4.5) {
  await expect(locator).toBeVisible()
  const ratio = await contrastRatio(locator)
  expect(ratio, `Contraste insuficiente: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum)
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.locator('html').evaluate(html => ({
    scrollWidth: html.scrollWidth,
    width: html.clientWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
}

for (const width of [320, 360, 390, 768, 1280]) {
  for (const tipo of ['PARTICULAR', 'EMPRESA'] as const) {
    test(`${tipo} ${width}px: controles sin Preflight conservan fondo, tipografía, foco y área táctil`, async ({ page }) => {
      const state = createState(tipo)
      state.receiptsError = true
      await page.setViewportSize({ width, height: 900 })
      await mockAccountApi(page, tipo, state)
      await page.goto('/mi-cuenta')

      const summary = page.getByRole('region', { name: 'Resumen de pedidos' })
      const retryReceipts = summary.getByRole('button', { name: 'Reintentar comprobantes' })
      await expectTextButton(retryReceipts)
      await expectFocusOutline(page, retryReceipts)

      await openMenuIfNeeded(page, width)
      const logout = page.getByRole('button', { name: 'Cerrar sesión', exact: true })
      await expectBorderedButton(logout, 'transparent')
      await expectFocusOutline(page, logout, 'rgb(255, 255, 255)')
      const back = page.getByRole('button', { name: 'Volver a tienda' })
      await expectTextButton(back)
      await expectFocusOutline(page, back, 'rgb(255, 255, 255)')
      await expectTouchTarget(back)
      await expectTouchTarget(logout)
      if (width < 768) await openMenuIfNeeded(page, width)

      await page.goto('/mi-cuenta/pedidos')
      await expectSelector(page.locator('#filtro-fecha'))
      await expectSelector(page.locator('#filtro-comprobante'))
      await expectSelector(page.locator('#filtro-estado'))
      await expectFocusOutline(page, page.locator('#filtro-estado'))

      await page.locator('#filtro-estado').selectOption('CONFIRMADO')
      const clear = page.getByRole('button', { name: 'Limpiar filtros' })
      await expectTextButton(clear)
      await expectFocusOutline(page, clear)

      const retryStates = page.getByRole('button', { name: 'Reintentar estados de comprobantes' })
      await expectTextButton(retryStates)
      await expectFocusOutline(page, retryStates)

      const detail = page.getByRole('button', { name: 'Ver detalle de PED-000001' })
      await expectBorderedButton(detail, 'white')
      await expectFocusOutline(page, detail)
      await detail.click()
      await page.mouse.move(0, 0)
      const hide = page.getByRole('button', { name: 'Ocultar detalle de PED-000001' })
      await expectBorderedButton(hide, 'white')

      const openReceipts = page.getByRole('button', { name: 'Ver comprobantes de PED-000001' })
      await expectBorderedButton(openReceipts, 'white')
      await expectFocusOutline(page, openReceipts)
      const retryAction = page.getByRole('button', { name: 'Reintentar estado de comprobantes de PED-000001' })
      await expectTextButton(retryAction)
      await expectFocusOutline(page, retryAction)
      await expectContrast(page.getByText('Estado no disponible', { exact: true }))

      await openReceipts.click()
      const dialog = page.getByRole('dialog')
      const close = dialog.getByRole('button', { name: 'Cerrar comprobantes' })
      await expectBorderedButton(close, 'white')
      await expectFocusOutline(page, close)
      await expectContrast(dialog.getByRole('alert'))
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(openReceipts).toBeFocused()

      await expectNoHorizontalOverflow(page)
    })
  }
}

test('Reintentar detalle conserva reset, foco y recupera el detalle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const state = createState('PARTICULAR')
  state.detailError = true
  await mockAccountApi(page, 'PARTICULAR', state)
  await page.goto('/mi-cuenta/pedidos')

  await page.getByRole('button', { name: 'Ver detalle de PED-000001' }).click()
  const retry = page.getByRole('button', { name: 'Reintentar detalle' })
  await expectBorderedButton(retry, 'white')
  await expectFocusOutline(page, retry)
  await expectContrast(page.getByRole('alert').filter({ hasText: 'No se pudo cargar el detalle' }))

  state.detailError = false
  await retry.click()
  await expect(page.getByText('Este pedido no tiene productos registrados.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('EMPRESA: badges de estado comercial y alertas cumplen contraste WCAG AA', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const state = createState('EMPRESA')
  state.approval = 'PENDIENTE'
  state.account = 'SIN_CUENTA'
  await mockAccountApi(page, 'EMPRESA', state)
  await page.goto('/mi-cuenta')

  const status = page.getByRole('region', { name: 'Estado comercial' })
  await expectContrast(status.getByText('Pendiente', { exact: true }))
  await expectContrast(status.getByText('Sin cuenta', { exact: true }))

  state.approval = 'APROBADA'
  state.account = 'HABILITADA'
  state.credit = 'DISPONIBLE'
  await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
  await expect(status.getByText('Aprobada', { exact: true })).toBeVisible()
  await expectContrast(status.getByText('Aprobada', { exact: true }))
  await expectContrast(status.getByText('Disponible', { exact: true }))

  state.credit = 'BLOQUEADO'
  await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
  await expect(status.getByText('Bloqueado', { exact: true })).toBeVisible()
  await expectContrast(status.getByText('Bloqueado', { exact: true }))

  state.account = 'INHABILITADA'
  await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
  await expect(status.getByText('Inhabilitada', { exact: true })).toBeVisible()
  await expectContrast(status.getByText('Inhabilitada', { exact: true }))

  state.approval = 'RECHAZADA'
  state.account = 'HABILITADA'
  state.credit = 'DISPONIBLE'
  await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
  await expect(status.getByText('Rechazada', { exact: true })).toBeVisible()
  await expectContrast(status.getByText('Rechazada', { exact: true }))

  state.failAccount = true
  await status.getByRole('button', { name: 'Actualizar estado comercial' }).click()
  const alert = status.getByRole('alert')
  await expect(alert).toContainText('No se pudo consultar el estado de la cuenta corriente')
  await expectContrast(alert)
  await expectNoHorizontalOverflow(page)
})

test('Comprobantes: badges, avisos y errores cumplen contraste WCAG AA', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const state = createState('EMPRESA')
  state.receipts = [receipt('r1', 'PENDIENTE'), receipt('r2', 'REVISADO')]
  await mockAccountApi(page, 'EMPRESA', state)
  await page.goto('/mi-cuenta/pedidos')

  await page.getByRole('button', { name: 'Ver comprobantes de PED-000001' }).click()
  const dialog = page.getByRole('dialog')
  await expectContrast(dialog.getByText('Pendiente de revisión', { exact: true }))
  await expectContrast(dialog.getByText('Revisado', { exact: true }))

  state.receiptsError = true
  await dialog.getByRole('button', { name: 'Cerrar comprobantes' }).click()
  await page.getByRole('button', { name: 'Ver comprobantes de PED-000001' }).click()
  const failedDialog = page.getByRole('dialog')
  const error = failedDialog.getByRole('alert')
  await expect(error).toHaveText('No se pudieron cargar los comprobantes.')
  await expectContrast(error)

  state.receiptsError = false
  await failedDialog.getByRole('button', { name: 'Reintentar comprobantes' }).click()
  await expect(error).toHaveCount(0)

  state.uploadFails = true
  const input = failedDialog.getByLabel(/Archivo \(PDF/)
  await input.setInputFiles({
    name: 'transferencia.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await failedDialog.getByRole('button', { name: 'Adjuntar comprobante' }).click()
  const failure = failedDialog.getByRole('alert')
  await expect(failure).toContainText('No se pudo procesar el comprobante')
  await expectContrast(failure)

  state.uploadFails = false
  await failedDialog.getByLabel(/Archivo \(PDF/).setInputFiles({
    name: 'transferencia.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await failedDialog.getByRole('button', { name: 'Adjuntar comprobante' }).click()
  const notice = failedDialog.getByRole('status').filter({ hasText: 'Comprobante recibido' })
  await expect(notice).toBeVisible()
  await expectContrast(notice)
  await expectNoHorizontalOverflow(page)
})
