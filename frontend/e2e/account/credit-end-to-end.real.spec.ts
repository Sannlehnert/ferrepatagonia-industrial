import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const password = 'E2eLocal-214!'

function origin(baseURL: string | undefined): string {
  return new URL(baseURL ?? process.env.E2E_BASE_URL!).origin
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()) as T
}

async function approveCompany(admin: APIRequestContext, baseURL: string, clientId: number) {
  const response = await admin.patch(`/api/admin/clientes/${clientId}/estado-empresa`, {
    headers: { Origin: origin(baseURL) },
    data: { estado: 'APROBADA' },
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function loginAdmin(page: Page, baseURL: string) {
  const response = await page.request.post('/api/auth/login', {
    headers: { Origin: origin(baseURL) },
    data: { email: 'admin@e2e.test', password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function loginCompany(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/mi-cuenta$/)
}

test('recorrido integral: empresa, solicitud, aprobación, habilitación y compra única a crédito', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000)
  expect(baseURL).toBeTruthy()
  const headers = { Origin: origin(baseURL) }
  const token = randomUUID().replaceAll('-', '').slice(0, 8)
  const email = `credit-354-e2e-${token}@e2e.test`
  const name = `Empresa integral ${token}`
  const cuit = `30-${token.slice(0, 8)}-1`

  // 1. Registro de la empresa.
  const registered = await request.post('/api/auth/register', {
    headers,
    data: {
      tipoCliente: 'EMPRESA',
      nombreRazonSocial: name,
      cuit,
      email,
      password,
    },
  })
  expect(registered.status(), await registered.text()).toBe(201)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  try {
    await loginAdmin(adminPage, baseURL!)

    // 2. Aprobación empresarial desde ADMIN.
    const clients = await json<{ data: { clientes: Array<{ id: number; email: string }> } }>(
      await adminPage.request.get('/api/admin/clientes', { params: { busqueda: email, limit: 10 } }),
    )
    const company = clients.data.clientes.find(client => client.email === email)
    if (!company) throw new Error('La empresa registrada no aparece en el listado ADMIN.')
    const clientId = company.id
    await approveCompany(adminPage.request, baseURL!, clientId)

    // 3. La empresa inicia sesión con su aprobación ya vigente.
    await loginCompany(page, email)
    await page.goto('/mi-cuenta/cuenta-corriente')
    await expect(page.getByText('Tu empresa está aprobada. La autorización de crédito se evalúa por separado.'))
      .toBeVisible()
    await expect(page.getByText('No tenés una cuenta corriente asociada.').first()).toBeVisible()

    // 4. Solicitud de crédito desde Mi Cuenta.
    await page.getByLabel('Monto solicitado (USD)').fill('500')
    await page.getByLabel('Plazo solicitado').selectOption('30')
    await page.getByLabel('Observaciones (opcional)').fill('Compra de insumos #354')
    const createdResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/cuenta-corriente/solicitudes' &&
      response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
    const created = await createdResponse
    expect(created.status(), await created.text()).toBe(201)
    const requestId = (await created.json()).data.solicitud.id as number
    await expect(page.getByText(`Solicitud #${requestId} · Pendiente`)).toBeVisible()
    await expect(page.getByText('Ya hay una solicitud pendiente. Podrás enviar otra cuando se resuelva.'))
      .toBeVisible()

    // 5. ADMIN consulta la solicitud pendiente.
    const pending = await json<{
      data: { items: Array<{ id: number; estado: string; clienteId: number }> }
    }>(await adminPage.request.get('/api/admin/solicitudes-credito', {
      params: { clienteId: clientId, estado: 'PENDIENTE', limite: 25 },
    }))
    expect(pending.data.items.map(item => [item.id, item.estado, item.clienteId]))
      .toEqual([[requestId, 'PENDIENTE', clientId]])

    // 6. Aprobación con límite y plazo válidos.
    const approved = await adminPage.request.post(`/api/admin/solicitudes-credito/${requestId}/aprobar`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        limiteAutorizado: '500.00',
        plazoDias: 30,
        evidencia: `ACTA-CREDITO-${token}`,
        motivo: 'Aprobación integral #354',
      },
    })
    expect(approved.status(), await approved.text()).toBe(200)

    // 7. La cuenta sigue inhabilitada después de aprobar la solicitud.
    const disabledAccount = await json<{ data: { estado: string; limite: string; plazoDias: number } }>(
      await adminPage.request.get(`/api/admin/clientes/${clientId}/cuenta-corriente`),
    )
    expect(disabledAccount.data.estado).toBe('INHABILITADA')
    expect(disabledAccount.data.limite).toBe('500.00')
    expect(disabledAccount.data.plazoDias).toBe(30)

    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    await expect(page.getByText(`Solicitud #${requestId} · Aprobada`)).toBeVisible()
    await expect(page.getByText('La cuenta está inhabilitada.', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('Límite de crédito (USD)')).toBeVisible()

    // 8. Habilitación por el procedimiento autorizado.
    const enabled = await adminPage.request.post(
      `/api/admin/clientes/${clientId}/cuenta-corriente/habilitar`,
      {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: { evidencia: `ACTA-HABILITACION-${token}` },
      },
    )
    expect(enabled.status(), await enabled.text()).toBe(200)

    // 9. La empresa consulta su crédito habilitado.
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    await expect(page.getByText(
      'La cuenta corriente está habilitada y el crédito está disponible. Cada compra está sujeta a validación.',
    )).toBeVisible()
    await expect(page.getByText('Crédito disponible (USD)')).toBeVisible()
    const clientSummary = await json<{
      data: {
        estado: string
        saldo: string
        limite: string
        utilizado: string
        disponible: string
        estadoCredito: string
      }
    }>(await page.request.get('/api/cuenta-corriente'))
    expect(clientSummary.data).toMatchObject({
      estado: 'HABILITADA',
      limite: '500.00',
      saldo: '0.00',
      utilizado: '0.00',
      disponible: '500.00',
      estadoCredito: 'DISPONIBLE',
    })
    for (const width of [320, 360, 390, 768, 1024, 1280] as const) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth',
      )).toBe(true)
      if (width === 390 || width === 1280) {
        await page.screenshot({
          path: `../docs/354/evidence/client-credit-available-${width}.png`,
          fullPage: true,
        })
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 })

    // 10. Compra válida a cuenta corriente desde el carrito.
    await page.goto('/catalogo?busqueda=E2E-24')
    const card = page.locator('li').filter({
      has: page.getByRole('heading', { name: 'Producto E2E 24', exact: true }),
    })
    const add = card.getByRole('button', { name: 'Agregar', exact: true })
    await expect(add).toBeEnabled()
    const added = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/carrito/items' &&
      response.request().method() === 'POST')
    await add.click()
    expect((await added).status()).toBe(204)
    await page.goto('/carrito')

    const summary = page.getByRole('region', { name: 'Resumen del carrito' })
    await expect(summary).toContainText('USD 124.00')
    await summary.getByRole('radio', { name: 'Cuenta corriente' }).check()
    const confirmButton = summary.getByRole('button', {
      name: 'Confirmar pedido a cuenta corriente',
    })
    await expect(confirmButton).toBeEnabled({ timeout: 15_000 })
    const confirmedResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/pedidos/cuenta-corriente' &&
      response.request().method() === 'POST')
    await confirmButton.click()
    const confirmed = await confirmedResponse
    expect(confirmed.status(), await confirmed.text()).toBe(201)
    const order = (await confirmed.json()).data as {
      pedidoId: number
      cargoId: string
      totalUSD: string
      estado: string
      modalidadPago: string
    }
    expect(order.estado).toBe('CONFIRMADO')
    expect(order.modalidadPago).toBe('CUENTA_CORRIENTE')
    expect(order.totalUSD).toBe('124.00')
    await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' }))
      .toContainText('USD 124.00')
    await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()

    // 11. Un único pedido y un único cargo.
    const clientOrders = await json<{
      data: { items: Array<{ pedidoId: number; total: string; totalUSD: string | null; modalidadPago: string }> }
    }>(await page.request.get('/api/pedidos'))
    const matchingOrders = clientOrders.data.items.filter(item => item.pedidoId === order.pedidoId)
    expect(matchingOrders).toHaveLength(1)
    expect(matchingOrders[0]).toMatchObject({
      total: '124.00', totalUSD: '124.00', modalidadPago: 'CUENTA_CORRIENTE',
    })

    const adminMovements = await json<{
      data: { items: Array<{ id: string; tipo: string; importe: string; referencia: { pedidoId?: number } }> }
    }>(await adminPage.request.get(`/api/admin/clientes/${clientId}/cuenta-corriente/movimientos`, {
      params: { limite: 25 },
    }))
    expect(adminMovements.data.items).toHaveLength(1)
    expect(adminMovements.data.items[0]).toMatchObject({
      tipo: 'CARGO', importe: '124.00', referencia: { pedidoId: order.pedidoId },
    })

    const adminOrders = await json<{
      data: { items: Array<{ idPedido: number }>; pagination: { total: number } }
    }>(await adminPage.request.get('/api/admin/pedidos', {
      params: { clienteId: clientId, page: 1 },
    }))
    expect(adminOrders.data.items.filter(item => item.idPedido === order.pedidoId)).toHaveLength(1)

    // 12. ADMIN consulta saldo, utilizado, disponible y movimientos.
    const adminAccount = await json<{
      data: {
        estado: string
        saldo: string
        limite: string
        utilizado: string
        disponible: string
        estadoCredito: string
      }
    }>(await adminPage.request.get(`/api/admin/clientes/${clientId}/cuenta-corriente`))
    expect(adminAccount.data).toMatchObject({
      estado: 'HABILITADA',
      saldo: '124.00',
      limite: '500.00',
      utilizado: '124.00',
      disponible: '376.00',
      estadoCredito: 'DISPONIBLE',
    })

    // 13. La información del cliente coincide con la de ADMIN.
    const clientAfter = await json<{
      data: { saldo: string; limite: string; utilizado: string; disponible: string }
    }>(await page.request.get('/api/cuenta-corriente'))
    expect(clientAfter.data).toMatchObject({
      saldo: adminAccount.data.saldo,
      limite: adminAccount.data.limite,
      utilizado: adminAccount.data.utilizado,
      disponible: adminAccount.data.disponible,
    })

    // 14. La interfaz ADMIN muestra las mismas cifras y un único movimiento.
    await adminPage.goto('/admin/cuentas-corrientes')
    await adminPage.getByLabel('Buscar empresa', { exact: true }).fill(`#${clientId}`)
    await adminPage.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
    const companyList = adminPage.getByRole('list').filter({
      has: adminPage.getByRole('button', { name: `Ver detalle de ${name}`, exact: true }),
    })
    await companyList.getByRole('button', { name: `Ver detalle de ${name}`, exact: true }).click()

    const detail = adminPage.getByRole('region', { name: `Cliente ${clientId}`, exact: true })
    await expect(detail.getByText(name, { exact: true }).first()).toBeVisible()
    for (const [label, amount] of [
      ['Saldo', '124,00'],
      ['Límite', '500,00'],
      ['Utilizado', '124,00'],
      ['Disponible', '376,00'],
    ] as const) {
      await expect(detail.getByText(label, { exact: true }).locator('..').locator('dd'))
        .toHaveText(`USD ${amount}`)
    }
    const movements = detail.getByRole('region', { name: 'Movimientos', exact: true })
    await expect(movements.getByRole('row')).toHaveCount(2)
    await expect(movements).toContainText(`Pedido #${order.pedidoId}`)
    await expect(movements).toContainText('USD 124,00')
    await expect(detail.getByText('Habilitada. Participa en la validación de compras a crédito.'))
      .toBeVisible()
    await expect(detail.getByText('Crédito disponible según la cuenta. Cada compra se revalida.'))
      .toBeVisible()

    expect(await adminPage.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    )).toBe(true)
  } finally {
    await adminContext.close()
  }
})
