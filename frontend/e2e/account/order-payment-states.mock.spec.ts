import { expect, test, type Page } from '@playwright/test'

const clientUser = {
  id: 12,
  nombre: 'Constructora Patagonia S.A.',
  email: 'empresa@example.test',
  rol: 'CLIENTE',
  tipo_cliente: 'EMPRESA',
  estadoAprobacionEmpresa: 'APROBADA',
  cuentaCorrienteHabilitada: true,
}

const adminUser = {
  id: 1,
  nombre: 'Administrador',
  email: 'admin@ferrepatagonia.test',
  rol: 'ADMIN',
  tipo_cliente: null,
  estadoAprobacionEmpresa: null,
  cuentaCorrienteHabilitada: null,
}

const clientOrders = [
  {
    pedidoId: 101,
    numero: 'PED-000101',
    fecha: '2026-11-20T14:00:00.000Z',
    estado: 'ENTREGADO',
    estadoPedido: 'ENTREGADO',
    estadoDocumental: 'APROBADO',
    estadoFinanciero: 'SIN_PAGO_ACREDITADO',
    montoAcreditadoUSD: '0.00',
    modalidadPago: 'TRANSFERENCIA',
    moneda: 'USD',
    subtotal: '150.00',
    descuento: '0.00',
    total: '150.00',
    totalUSD: '150.00',
    cantidadLineas: 1,
    cantidadUnidades: 1,
    cargoId: null,
    venceEl: null,
    items: [
      {
        detalleId: 1,
        productoId: 10,
        codigo: 'SKU-101',
        nombre: 'Taladro Industrial 900W',
        cantidad: 1,
        precioUnitario: '150.00',
        descuento: '0.00',
        subtotal: '150.00',
      },
    ],
  },
  {
    pedidoId: 102,
    numero: 'PED-000102',
    fecha: '2026-11-20T15:00:00.000Z',
    estado: 'CONFIRMADO',
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'RECHAZADO',
    estadoFinanciero: 'SIN_PAGO_ACREDITADO',
    montoAcreditadoUSD: '0.00',
    modalidadPago: 'TRANSFERENCIA',
    moneda: 'USD',
    subtotal: '90.00',
    descuento: '0.00',
    total: '90.00',
    totalUSD: '90.00',
    cantidadLineas: 1,
    cantidadUnidades: 1,
    cargoId: null,
    venceEl: null,
    items: [],
  },
  {
    pedidoId: 103,
    numero: 'PED-000103',
    fecha: '2026-11-20T16:00:00.000Z',
    estado: 'EN_PREPARACION',
    estadoPedido: 'EN_PREPARACION',
    estadoDocumental: 'SIN_COMPROBANTE',
    estadoFinanciero: 'CARGO_PENDIENTE',
    montoAcreditadoUSD: '0.00',
    modalidadPago: 'CUENTA_CORRIENTE',
    moneda: 'USD',
    subtotal: '240.00',
    descuento: '0.00',
    total: '240.00',
    totalUSD: '240.00',
    cantidadLineas: 1,
    cantidadUnidades: 2,
    cargoId: '501',
    venceEl: '2026-12-20',
    items: [],
  },
  {
    pedidoId: 104,
    numero: 'PED-000104',
    fecha: '2026-11-20T17:00:00.000Z',
    estado: 'ENVIADO',
    estadoPedido: 'ENVIADO',
    estadoDocumental: 'APROBADO',
    estadoFinanciero: 'PAGO_PARCIAL',
    montoAcreditadoUSD: '50.00',
    modalidadPago: 'TRANSFERENCIA',
    moneda: 'USD',
    subtotal: '120.00',
    descuento: '0.00',
    total: '120.00',
    totalUSD: '120.00',
    cantidadLineas: 1,
    cantidadUnidades: 1,
    cargoId: null,
    venceEl: null,
    items: [],
  },
]

const receiptsByOrder: Record<number, Array<Record<string, unknown>>> = {
  101: [
    {
      id: '11111111-1111-4111-8111-111111111101',
      pedidoId: 101,
      cuentaCorrienteId: null,
      tipoMime: 'application/pdf',
      bytes: 1024,
      fecha: '2026-11-20T14:15:00.000Z',
      estadoRevision: 'APROBADO',
      revisadoEn: '2026-11-20T14:30:00.000Z',
      motivoRechazo: null,
    },
  ],
  102: [
    {
      id: '11111111-1111-4111-8111-111111111102',
      pedidoId: 102,
      cuentaCorrienteId: null,
      tipoMime: 'image/png',
      bytes: 512,
      fecha: '2026-11-20T15:15:00.000Z',
      estadoRevision: 'RECHAZADO',
      revisadoEn: '2026-11-20T15:30:00.000Z',
      motivoRechazo: 'Comprobante ilegible: no se distingue el importe transferido.',
    },
  ],
  103: [],
  104: [
    {
      id: '11111111-1111-4111-8111-111111111104',
      pedidoId: 104,
      cuentaCorrienteId: null,
      tipoMime: 'image/jpeg',
      bytes: 800,
      fecha: '2026-11-20T17:15:00.000Z',
      estadoRevision: 'APROBADO',
      revisadoEn: '2026-11-20T17:30:00.000Z',
      motivoRechazo: null,
    },
  ],
}

async function mockClientApis(page: Page) {
  await page.route('**/socket.io/**', route => route.abort())
  await page.route('**/api/**', route => route.fulfill({ json: { data: { items: [] } } }))
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => route.fulfill({ json: { user: clientUser } }))
  await page.route(/\/api\/perfil(?:\?.*)?$/, route => route.fulfill({
    json: {
      data: {
        nombreRazonSocial: clientUser.nombre,
        email: clientUser.email,
        tipoCliente: 'EMPRESA',
        cuit: '30-11111111-9',
        docCliente: null,
        telefono: null,
        direccion: null,
      },
    },
  }))
  await page.route(/\/api\/pedidos$/, route => route.fulfill({
    json: { data: { items: clientOrders } },
  }))
  await page.route(/\/api\/pedidos\/(\d+)$/, route => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1))
    const found = clientOrders.find(order => order.pedidoId === id)
    return route.fulfill({ status: found ? 200 : 404, json: { data: found } })
  })
  await page.route(/\/api\/pedidos\/(\d+)\/comprobantes(?:\?.*)?$/, route => {
    const match = /\/api\/pedidos\/(\d+)\/comprobantes/.exec(new URL(route.request().url()).pathname)
    const id = Number(match?.[1] ?? 0)
    return route.fulfill({
      json: { data: { items: receiptsByOrder[id] ?? [], paginaSiguiente: null } },
    })
  })
}

async function assertNoOverflow(page: Page) {
  const fits = await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')
  expect(fits).toBe(true)
}

for (const width of [360, 768, 1280]) {
  test(`CLIENTE visualiza los tres dominios coherentes entre listado y detalle a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockClientApis(page)

    await page.goto('/mi-cuenta')
    await expect(
      page.getByRole('link', { name: /Pedidos sin comprobante/ }).filter({ hasText: 'Sin comprobante adjunto' }),
    ).toContainText('1')
    await assertNoOverflow(page)

    await page.goto('/mi-cuenta/pedidos')
    const order101 = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'PED-000101', exact: true }),
    })
    await expect(order101.getByText('Entregado', { exact: true })).toBeVisible()
    await expect(order101.getByText('Aprobado', { exact: true })).toBeVisible()
    await expect(order101.getByText('Sin pago acreditado', { exact: true })).toBeVisible()
    await expect(order101).not.toContainText(/\bPagado\b/i)

    await order101.getByRole('button', { name: 'Ver detalle de PED-000101', exact: true }).click()
    const detailSection101 = order101.getByRole('region', { name: 'Estados del pedido' })
    await expect(detailSection101.getByText('Entregado', { exact: true })).toBeVisible()
    await expect(detailSection101.getByText('Aprobado', { exact: true })).toBeVisible()
    await expect(detailSection101.getByText('Sin pago acreditado', { exact: true })).toBeVisible()
    await expect(detailSection101).toContainText('el pago todavía no fue acreditado')

    const order102 = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'PED-000102', exact: true }),
    })
    await expect(order102.getByText('Confirmado', { exact: true })).toBeVisible()
    await expect(order102.getByText('Rechazado', { exact: true })).toBeVisible()
    await expect(order102.getByText('Sin pago acreditado', { exact: true })).toBeVisible()
    await order102.getByRole('button', { name: 'Ver detalle de PED-000102', exact: true }).click()
    await expect(order102).toContainText('Motivo de rechazo:')
    await expect(order102).toContainText('Comprobante ilegible: no se distingue el importe transferido.')

    const order103 = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'PED-000103', exact: true }),
    })
    await expect(order103.getByText('En preparación', { exact: true })).toBeVisible()
    await expect(order103.getByText('No adjunto', { exact: true })).toBeVisible()
    await expect(order103.getByText('Imputado a cuenta corriente — pendiente de cancelación', { exact: true })).toBeVisible()

    const order104 = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'PED-000104', exact: true }),
    })
    await expect(order104.getByText('Enviado', { exact: true })).toBeVisible()
    await expect(order104.getByText('Pago parcial acreditado', { exact: true })).toBeVisible()
    await expect(order104).toContainText('Acreditado: US$ 50,00')

    await assertNoOverflow(page)
  })
}

for (const width of [360, 768, 1280]) {
  test(`ADMIN visualiza los tres dominios coherentes y rechaza comprobante con motivo a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/socket.io/**', route => route.abort())
    await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => route.fulfill({ json: { user: adminUser } }))
    await page.route(/\/api\/admin\/pagos(?:\?.*)?$/, route => route.fulfill({
      json: { data: { items: [], paginaSiguiente: null } },
    }))

    const adminOrders = [
      {
        idPedido: 201,
        fecha: '2026-11-20T14:00:00.000Z',
        estado: 'ENTREGADO',
        estadoPedido: 'ENTREGADO',
        estadoDocumental: 'RECHAZADO',
        estadoFinanciero: 'SIN_PAGO_ACREDITADO',
        montoAcreditadoUSD: '0.00',
        estadosPermitidos: [],
        modalidadPago: 'TRANSFERENCIA',
        moneda: 'USD',
        subtotal: '150.00',
        descuento: '0.00',
        total: '150.00',
        evidenciaTotalUSD: null,
        observaciones: null,
        cantidadItems: 1,
        totalUnidades: 1,
        cargoCuentaCorrienteId: null,
        origen: 'REAL',
        comprobantes: { total: 1, pendientesRevision: 0 },
        cliente: {
          idCliente: 12,
          tipoCliente: 'PARTICULAR',
          nombreRazonSocial: 'Juan Pérez',
          documento: '30111222',
          cuit: null,
          email: 'juan@example.test',
          estadoAprobacionEmpresa: null,
          esFiel: false,
          activo: true,
          telefono: null,
          direccion: null,
        },
        items: [
          {
            idDetallePedido: 1,
            idProducto: 10,
            codigoProducto: 'SKU-201',
            nombreProducto: 'Amoladora',
            cantidad: 1,
            precioUnitario: '150.00',
            descuento: '0.00',
            subtotal: '150.00',
            reglaPrecio: 'FER17-v1',
          },
        ],
      },
    ]

    const adminReceipts: Array<{
      id: string
      clienteId: number
      cliente: string
      pedidoId: number | null
      cuentaCorrienteId: number | null
      tipoMime: string
      bytes: number
      fecha: string
      estadoRevision: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'
      revisadoEn: string | null
      motivoRechazo: string | null
    }> = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        clienteId: 12,
        cliente: 'Juan Pérez',
        pedidoId: 201,
        cuentaCorrienteId: null,
        tipoMime: 'image/png',
        bytes: 400,
        fecha: '2026-11-20T14:15:00.000Z',
        estadoRevision: 'PENDIENTE',
        revisadoEn: null,
        motivoRechazo: null,
      },
    ]

    await page.route(/\/api\/admin\/pedidos(?:\?.*)?$/, route => route.fulfill({
      json: {
        data: {
          items: adminOrders,
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
    }))
    await page.route(/\/api\/admin\/pedidos\/201$/, route => route.fulfill({
      json: { data: adminOrders[0] },
    }))
    await page.route(/\/api\/admin\/comprobantes(?:\?.*)?$/, route => route.fulfill({
      json: { data: { items: adminReceipts, paginaSiguiente: null } },
    }))

    let capturedRejectPayload: Record<string, unknown> | null = null
    let capturedRejectKey = ''
    await page.route(/\/api\/admin\/comprobantes\/[^/]+\/revision$/, route => {
      capturedRejectPayload = route.request().postDataJSON() as Record<string, unknown>
      capturedRejectKey = route.request().headers()['idempotency-key'] ?? ''
      adminReceipts[0] = {
        ...adminReceipts[0]!,
        estadoRevision: 'RECHAZADO',
        revisadoEn: '2026-11-20T15:00:00.000Z',
        motivoRechazo: String(capturedRejectPayload.motivo ?? ''),
      }
      return route.fulfill({ status: 200, json: { data: adminReceipts[0] } })
    })

    await page.goto('/admin/pedidos')
    const row = page.getByRole('row').filter({
      has: page.getByRole('button', { name: 'Ver detalle del pedido 201', exact: true }),
    })
    await expect(row.getByText('Entregado', { exact: true })).toBeVisible()
    await expect(row.getByText('Rechazado', { exact: true })).toBeVisible()
    await expect(row.getByText('Sin pago acreditado', { exact: true })).toBeVisible()
    await expect(row).not.toContainText('Revisados')
    await expect(row).not.toContainText(/\bPagado\b/i)

    await row.getByRole('button', { name: 'Ver detalle del pedido 201', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Entregado', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Rechazado', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Sin pago acreditado', { exact: true })).toBeVisible()
    await expect(dialog).not.toContainText('Revisados')
    await page.keyboard.press('Escape')
    await assertNoOverflow(page)

    await page.goto('/admin/comprobantes')
    const receiptsRegion = page.getByRole('region', { name: 'Comprobantes de pago' })
    const receiptItem = receiptsRegion.getByRole('listitem').first()
    await expect(receiptItem.getByText('Pendiente de revisión', { exact: true })).toBeVisible()
    await receiptItem.getByRole('button', { name: 'Rechazar comprobante' }).click()
    await receiptItem.getByLabel('Motivo de rechazo documental (obligatorio)').fill('Transferencia de otra operación')
    await receiptItem.getByRole('button', { name: 'Confirmar rechazo' }).click()

    await expect(receiptItem.getByText('Rechazado', { exact: true })).toBeVisible()
    await expect(receiptItem).toContainText('Motivo de rechazo:')
    await expect(receiptItem).toContainText('Transferencia de otra operación')
    expect(capturedRejectPayload).toEqual({
      estado: 'RECHAZADO',
      motivo: 'Transferencia de otra operación',
    })
    expect(capturedRejectKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    await assertNoOverflow(page)
  })
}

test('ADMIN /admin/comprobantes a 360px no desborda con filtro documental y motivo largo sin espacios (1000 chars)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 })
  await page.route('**/socket.io/**', route => route.abort())
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => route.fulfill({ json: { user: adminUser } }))

  const longReason = 'X'.repeat(1000)
  await page.route(/\/api\/admin\/comprobantes(?:\?.*)?$/, route => route.fulfill({
    json: {
      data: {
        items: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            clienteId: 12,
            cliente: 'Constructora Patagonia S.A.',
            pedidoId: 202,
            cuentaCorrienteId: null,
            tipoMime: 'application/pdf',
            bytes: 1024,
            fecha: '2026-11-20T14:15:00.000Z',
            estadoRevision: 'RECHAZADO',
            revisadoEn: '2026-11-20T15:00:00.000Z',
            motivoRechazo: longReason,
          },
        ],
        paginaSiguiente: null,
      },
    },
  }))

  await page.goto('/admin/comprobantes')
  const filterSelect = page.getByLabel('Filtrar comprobantes por estado documental')
  await expect(filterSelect).toBeVisible()
  const filterBox = await filterSelect.boundingBox()
  expect(filterBox).not.toBeNull()
  expect(filterBox!.x).toBeGreaterThanOrEqual(0)
  expect(filterBox!.x + filterBox!.width).toBeLessThanOrEqual(360)

  await expect(page.getByText(longReason)).toBeVisible()
  const fits = await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
  expect(fits).toBe(true)
})

test('CLIENTE detalle expandido en /mi-cuenta/pedidos a 768px no solapa columnas de estado ni desborda', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 })
  await mockClientApis(page)

  await page.goto('/mi-cuenta/pedidos')
  const order101 = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'PED-000101', exact: true }),
  })
  await order101.getByRole('button', { name: 'Ver detalle de PED-000101', exact: true }).click()

  const detailSection = order101.getByRole('region', { name: 'Estados del pedido' })
  await expect(detailSection).toBeVisible()
  const columns = detailSection.locator('> div')
  await expect(columns).toHaveCount(3)

  const boxes = await Promise.all([0, 1, 2].map(i => columns.nth(i).boundingBox()))
  for (const box of boxes) {
    expect(box).not.toBeNull()
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      const overlaps = !(
        a.x + a.width <= b.x + 1 ||
        b.x + b.width <= a.x + 1 ||
        a.y + a.height <= b.y + 1 ||
        b.y + b.height <= a.y + 1
      )
      expect(overlaps).toBe(false)
    }
  }

  const fits = await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
  expect(fits).toBe(true)
})
