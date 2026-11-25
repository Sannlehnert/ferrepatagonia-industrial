import { expect, test, type Page } from '@playwright/test'

const admin = { id: 1, email: 'admin@ferrepatagonia.test', rol: 'ADMIN', tipoCliente: null }

function makeOrder(index: number) {
  const demo = index === 22
  const estado = demo ? 'DEMO_REGISTRADO' : index === 0 ? 'CONFIRMADO' : 'EN_PREPARACION'
  const modalidadPago = demo ? 'DEMO_DIRECTO' : index < 22 ? 'TRANSFERENCIA' : 'CUENTA_CORRIENTE'
  const moneda = index === 3 ? null : 'USD'
  const estadoDocumental = index === 0 ? 'PENDIENTE' : 'SIN_COMPROBANTE'
  const estadoFinanciero = demo || moneda === null
    ? 'NO_DETERMINABLE'
    : modalidadPago === 'TRANSFERENCIA'
      ? 'SIN_PAGO_ACREDITADO'
      : 'CARGO_PENDIENTE'
  return {
    idPedido: 1001 + index, fecha: '2026-11-18T12:00:00Z', estado,
    estadoPedido: estado, estadoDocumental, estadoFinanciero,
    montoAcreditadoUSD: estadoFinanciero === 'NO_DETERMINABLE' ? null : '0.00',
    estadosPermitidos: demo ? [] : estado === 'CONFIRMADO' ? ['EN_PREPARACION'] : ['ENVIADO', 'ENTREGADO'],
    modalidadPago,
    moneda, subtotal: '123.45', descuento: '0.00', total: '123.45',
    evidenciaTotalUSD: null, observaciones: null, cantidadItems: 1, totalUnidades: 1,
    cargoCuentaCorrienteId: null, origen: demo ? 'DEMO' : 'REAL',
    comprobantes: { total: index === 0 ? 2 : 0, pendientesRevision: index === 0 ? 1 : 0 },
    cliente: {
      idCliente: index + 1, tipoCliente: 'EMPRESA', nombreRazonSocial: `Cliente de prueba ${index + 1}`,
      documento: null, cuit: '30-11111111-9', email: 'cliente@example.test',
      estadoAprobacionEmpresa: 'APROBADA', esFiel: false, activo: true,
      telefono: null, direccion: null,
    },
    items: [{ idDetallePedido: index + 1, codigoProducto: 'SKU-1', nombreProducto: 'Taladro', cantidad: 1, subtotal: '123.45' }],
  }
}

async function setup(page: Page, count = 44) {
  const orders = Array.from({ length: count }, (_, index) => makeOrder(index))
  const reads: URL[] = []
  await page.route(/\/api\/admin\/dashboard\/metricas(?:\?.*)?$/, route => route.fulfill({ json: { data: {
    corte: '2026-11-20T12:00:00Z', origenDatos: 'REAL', umbralStockBajo: 5,
    pedidosPorEstado: { CONFIRMADO: 1, EN_PREPARACION: 2, ENVIADO: 3, ENTREGADO: 4, totalOperativos: 10 },
    indicadores: {
      pedidosNuevos: 1, pedidosEnCurso: 5,
      pedidosCuentaCorriente: orders.filter(order => order.modalidadPago === 'CUENTA_CORRIENTE').length,
      comprobantesTotales: 2, comprobantesSinRevisar: 1, alertasStockBajo: 4, productosSinStock: 1, empresasFieles: 3,
    },
  } } }))
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => route.fulfill({ json: { user: admin } }))
  await page.route(/\/api\/admin\/pagos(?:\?.*)?$/, route => route.fulfill({ json: { data: { items: [], paginaSiguiente: null } } }))
  await page.route(/\/api\/admin\/pedidos(?:\?.*)?$/, route => {
    const url = new URL(route.request().url())
    reads.push(url)
    const params = url.searchParams
    const q = params.get('q')?.toLowerCase()
    const filtered = orders.filter(order =>
      (!q || String(order.idPedido) === q || order.cliente.nombreRazonSocial.toLowerCase().includes(q)) &&
      (!params.get('estado') || order.estado === params.get('estado')) &&
      (!params.get('modalidadPago') || order.modalidadPago === params.get('modalidadPago')),
    )
    const current = Number(params.get('page') ?? 1), limit = Number(params.get('limit') ?? 20)
    return route.fulfill({ json: { data: {
      items: filtered.slice((current - 1) * limit, current * limit),
      pagination: { page: current, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) },
    } } })
  })
  await page.route(/\/api\/admin\/pedidos\/\d+$/, route => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1))
    return route.fulfill({ json: { data: orders.find(order => order.idPedido === id) } })
  })
  return reads
}

async function fits(page: Page) {
  expect(await page.locator('html').evaluate(html => html.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
}

for (const width of [360, 1280]) {
  test(`dashboard y pedidos conservan cifras, filtros y detalle a ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const reads = await setup(page)
    await page.goto('/admin/dashboard')
    const summary = page.getByRole('region', { name: 'Resumen', exact: true })
    await expect(summary.getByLabel('Pedidos nuevos', { exact: true })).toHaveText('1')
    await expect(summary.getByLabel('Pedidos con cuenta corriente', { exact: true })).toHaveText('21')
    await expect(summary.getByLabel('Comprobantes recibidos', { exact: true })).toHaveText('2')
    await expect(summary.getByLabel('Comprobantes sin evaluar', { exact: true })).toHaveText('1')
    await expect(summary.getByLabel('Alertas de stock', { exact: true })).toHaveText('4')
    await expect(summary.getByLabel('Empresas fieles', { exact: true })).toHaveText('3')
    await expect(summary.getByRole('region', { name: 'Pedidos por estado', exact: true })).toContainText('10 pedidos operativos')
    await expect(summary.locator('dl[aria-label="Indicadores"]').getByRole('definition')).toHaveCount(6)
    await expect(summary.getByRole('columnheader')).toHaveCount(7)
    const receiptRow = summary.getByRole('row').filter({ has: page.getByRole('link', { name: 'Ver pedido #1001', exact: true }) })
    await expect(receiptRow).toContainText('2 comprobantes')
    await expect(receiptRow).toContainText('1 pendiente')
    await expect(receiptRow.getByText('Pendiente de revisión', { exact: true })).toBeVisible()
    await expect(receiptRow.getByText('Sin pago acreditado', { exact: true })).toBeVisible()
    await expect(summary.getByRole('link', { name: 'Ver todos los pedidos' })).toHaveCount(0)
    await expect(summary.getByRole('link', { name: 'Consultar comprobantes' })).toHaveCount(0)
    await expect(summary.getByText('Confirmado', { exact: true })).toBeVisible()
    const badgeSize = await summary.getByText('Confirmado', { exact: true }).evaluate(element => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    })
    expect(badgeSize).toEqual({ width: 136, height: 28 })
    expect(reads.some(url => url.searchParams.get('limit') === '5')).toBe(true)
    expect(reads.some(url => url.searchParams.get('limit') === '1')).toBe(false)
    await expect(summary.getByRole('button', { name: 'Actualizar pedidos' })).toHaveCSS('cursor', 'pointer')
    await fits(page)
    await info.attach(`dashboard-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await summary.getByRole('link', { name: 'Ver pedido #1001', exact: true }).click()
    await expect(page.getByLabel('Buscar pedidos por empresa, ID o CUIT')).toHaveValue('1001')
    await expect(page.getByRole('region', { name: 'Listado de pedidos' }).getByRole('row')).toHaveCount(2)
    await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
    await page.getByLabel('Filtrar por estado del pedido').selectOption('EN_PREPARACION')
    await page.getByLabel('Filtrar por modalidad de pago').selectOption('TRANSFERENCIA')
    await page.getByLabel('Filtrar por fecha', { exact: true }).fill('2026-11-18')
    await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
    const pagination = page.getByRole('navigation', { name: 'Paginación de pedidos', exact: true })
    await expect(pagination.getByText('1–20 de 21 pedidos', { exact: true })).toBeVisible()
    await pagination.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await expect(pagination.getByText('21–21 de 21 pedidos', { exact: true })).toBeVisible()
    expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
      page: '2', limit: '20', estado: 'EN_PREPARACION', modalidadPago: 'TRANSFERENCIA', fecha: '2026-11-18',
    })
    expect(await page.getByLabel('Filtrar por fecha', { exact: true }).evaluate(input =>
      input.getBoundingClientRect().right <= input.parentElement!.getBoundingClientRect().right + 1,
    )).toBe(true)
    await expect(page.getByRole('button', { name: 'Ver detalle del pedido 1022', exact: true })).toBeInViewport({ ratio: 1 })
    await fits(page)
    await info.attach(`pedidos-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    const trigger = page.getByRole('button', { name: 'Ver detalle del pedido 1022', exact: true })
    await expect(trigger).toHaveCSS('cursor', 'pointer')
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Transferencia bancaria', { exact: true })).toBeVisible()
    await expect(dialog.getByText('USD 123.45', { exact: true })).toHaveCount(2)
    await expect(dialog.getByText('Este detalle no informa el estado documental ni el saldo pendiente.')).toHaveCount(0)
    await expect(dialog.getByRole('combobox')).toHaveValue('ENVIADO')
    await expect(dialog.getByRole('button', { name: 'Guardar Estado' })).toBeEnabled()
    await fits(page)
    await info.attach(`detalle-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Cerrar modal' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(pagination.getByText('21–21 de 21 pedidos', { exact: true })).toBeVisible()
  })
}

for (const width of [360, 1280]) {
  test(`paginación única, límites y scroll del listado a ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const reads = await setup(page, 104)
    await page.goto('/admin/pedidos')
    const navigation = page.getByRole('navigation', { name: 'Paginación de pedidos', exact: true })
    await expect(navigation).toHaveCount(1)
    const input = navigation.getByLabel('Ir a página', { exact: true })
    const region = page.getByRole('region', { name: 'Listado de pedidos', exact: true })
    await expect(input).toHaveValue('1')
    await expect(navigation.getByRole('button', { name: 'Anterior', exact: true })).toBeDisabled()
    if (width === 1280) {
      const geometry = await region.evaluate(element => {
        const doc = element.ownerDocument
        return { internal: element.scrollHeight > element.clientHeight, page: doc.documentElement.scrollHeight, viewport: doc.defaultView!.innerHeight }
      })
      expect(geometry.internal).toBe(true)
      expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1)
      await expect(navigation).toBeInViewport({ ratio: 1 })
      const head = region.getByRole('columnheader').first()
      const before = (await head.boundingBox())!.y
      await region.evaluate(element => { element.scrollTop = 400 })
      expect(Math.abs((await head.boundingBox())!.y - before)).toBeLessThanOrEqual(1)
      const styles = await region.getByRole('columnheader').evaluateAll(headers => headers.map(header => {
        const style = header.ownerDocument.defaultView!.getComputedStyle(header)
        return [style.fontSize, style.fontWeight, style.lineHeight, header.getBoundingClientRect().y].join('|')
      }))
      expect(new Set(styles).size).toBe(1)
      await region.evaluate(element => { element.scrollTop = 0 })
    } else {
      expect(await page.locator('html').evaluate(html => html.scrollHeight)).toBeGreaterThan(900)
      await navigation.scrollIntoViewIfNeeded()
      const previous = (await navigation.getByRole('button', { name: 'Anterior', exact: true }).boundingBox())!
      const next = (await navigation.getByRole('button', { name: 'Siguiente', exact: true }).boundingBox())!
      const field = (await input.boundingBox())!
      expect(field.x).toBeGreaterThan(previous.x + previous.width)
      expect(field.x + field.width).toBeLessThan(next.x)
    }
    await info.attach(`listado-scroll-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await input.fill('99')
    const count = reads.length
    await navigation.getByRole('button', { name: 'Ir', exact: true }).click()
    await expect(navigation.getByText('101–104 de 104 pedidos', { exact: true })).toBeVisible()
    await expect(input).toHaveValue('6')
    await expect(navigation.getByText('Mostrando la última página disponible.')).toBeVisible()
    expect(reads).toHaveLength(count + 1)
    expect(reads.at(-1)!.searchParams.get('page')).toBe('6')
    await expect(navigation.getByRole('alert')).toHaveCount(0)
    await input.fill('0')
    await input.press('Enter')
    await expect(input).toHaveValue('1')
    await expect(navigation.getByText('1–20 de 104 pedidos', { exact: true })).toBeVisible()
    await page.getByLabel('Buscar pedidos por empresa, ID o CUIT').fill('Cliente')
    await page.getByLabel('Filtrar por estado del pedido').selectOption('EN_PREPARACION')
    await page.getByLabel('Filtrar por modalidad de pago').selectOption('CUENTA_CORRIENTE')
    await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
    await expect(navigation.getByText('1–20 de 81 pedidos', { exact: true })).toBeVisible()
    await input.fill('2')
    await input.press('Enter')
    await expect(navigation.getByText('21–40 de 81 pedidos', { exact: true })).toBeVisible()
    expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({ page: '2', limit: '20', estado: 'EN_PREPARACION', modalidadPago: 'CUENTA_CORRIENTE', q: 'Cliente' })
    const requests = reads.length
    for (const invalid of ['1.5', 'abc', '']) {
      await input.fill(invalid)
      await input.press('Enter')
      await expect(navigation.getByRole('alert')).toHaveText('Ingresá un número de página entero.')
      expect(reads).toHaveLength(requests)
    }
    let started!: () => void, release!: () => void
    const requested = new Promise<void>(resolve => { started = resolve })
    const delivery = new Promise<void>(resolve => { release = resolve })
    await page.route(/\/api\/admin\/pedidos(?:\?.*)?$/, async route => {
      started(); await delivery; await route.fallback()
    }, { times: 1 })
    try {
      await input.fill('5')
      await input.press('Enter')
      await requested
      await expect(input).toBeDisabled()
      await expect(navigation.getByRole('button', { name: 'Siguiente', exact: true })).toBeDisabled()
    } finally { release() }
    await expect(navigation.getByText('81–81 de 81 pedidos', { exact: true })).toBeVisible()
    expect(reads).toHaveLength(requests + 1)
    await expect(navigation.getByRole('button', { name: 'Siguiente', exact: true })).toBeDisabled()
    await fits(page)
  })
}

test('el resumen distingue cero métricas de una consulta fallida y permite reintentar', async ({ page }) => {
  await setup(page)
  let fail = true
  await page.route(/\/api\/admin\/pedidos(?:\?.*)?$/, route => route.fulfill(fail
    ? { status: 503, json: { message: 'No disponible' } }
    : { json: { data: { items: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 } } } }),
  )
  await page.route(/\/api\/admin\/dashboard\/metricas(?:\?.*)?$/, route => route.fulfill(fail
    ? { status: 503, json: { message: 'No disponible' } }
    : { json: { data: { corte: '2026-11-20T12:00:00Z', origenDatos: 'REAL', umbralStockBajo: 5,
      pedidosPorEstado: { CONFIRMADO: 0, EN_PREPARACION: 0, ENVIADO: 0, ENTREGADO: 0, totalOperativos: 0 },
      indicadores: { pedidosNuevos: 0, pedidosEnCurso: 0, pedidosCuentaCorriente: 0, comprobantesTotales: 0, comprobantesSinRevisar: 0, alertasStockBajo: 0, productosSinStock: 0, empresasFieles: 0 },
    } } }),
  )
  await page.goto('/admin/dashboard')
  const summary = page.getByRole('region', { name: 'Resumen', exact: true })
  await expect(summary.getByRole('alert')).toHaveCount(2)
  await expect(summary.getByLabel('Pedidos nuevos', { exact: true })).toContainText('—')
  fail = false
  await summary.getByRole('button', { name: 'Actualizar pedidos' }).click()
  await expect(summary.getByLabel('Pedidos nuevos', { exact: true })).toHaveText('0')
  await expect(summary.getByText('Todavía no hay pedidos registrados.')).toBeVisible()
})

test('el listado no acredita pagos ni inventa moneda, identifica DEMO y permite recuperar errores', async ({ page }) => {
  await setup(page)
  await page.goto('/admin/pedidos')
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Ver detalle del pedido 1004', exact: true }) })
  await expect(row).toContainText('123.45')
  await expect(row).not.toContainText('USD')
  await page.getByLabel('Filtrar por estado del pedido').selectOption('DEMO_REGISTRADO')
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Listado de pedidos' })).toContainText('Registrado (DEMO)')
  await page.getByRole('button', { name: 'Ver detalle del pedido 1023', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Guardar Estado' })).toHaveCount(0)
  await expect(dialog).toContainText('no admite transiciones manuales')
  await dialog.getByRole('button', { name: 'Cerrar modal' }).click()
  await page.route(/\/api\/admin\/pedidos(?:\?.*)?$/, route => route.fulfill({ status: 503, json: {} }), { times: 1 })
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No pudimos consultar el listado')
  await page.getByRole('button', { name: 'Reintentar consulta' }).click()
  await expect(page.getByRole('button', { name: 'Ver detalle del pedido 1023', exact: true })).toBeVisible()
})

for (const failed of ['metrics', 'recent'] as const) {
  test(`un error de ${failed} conserva la otra sección del dashboard`, async ({ page }) => {
    await setup(page)
    let fail = true
    await page.route(failed === 'metrics' ? '**/api/admin/dashboard/metricas' : /\/api\/admin\/pedidos(?:\?.*)?$/,
      route => fail ? route.fulfill({ status: 503, json: {} }) : route.fallback())
    await page.goto('/admin/dashboard')
    const summary = page.getByRole('region', { name: 'Resumen', exact: true })
    await expect(summary.getByRole('alert')).toHaveCount(1)
    if (failed === 'metrics') {
      await expect(summary.getByLabel('Pedidos nuevos', { exact: true })).toContainText('—')
      await expect(summary.getByRole('link', { name: 'Ver pedido #1001', exact: true })).toBeVisible()
      fail = false
      await summary.getByRole('button', { name: 'Reintentar indicadores', exact: true }).click()
    } else {
      await expect(summary.getByLabel('Pedidos nuevos', { exact: true })).toHaveText('1')
      fail = false
      await summary.getByRole('button', { name: 'Actualizar pedidos', exact: true }).click()
    }
    await expect(summary.getByRole('alert')).toHaveCount(0)
    await expect(summary.getByLabel('Pedidos nuevos', { exact: true })).toHaveText('1')
    await expect(summary.getByRole('link', { name: 'Ver pedido #1001', exact: true })).toBeVisible()
  })
}
