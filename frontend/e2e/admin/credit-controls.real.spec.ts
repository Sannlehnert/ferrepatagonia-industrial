import { randomUUID } from 'node:crypto'
import { expect, test as base } from '@playwright/test'

type CreditCompany = { email: string; clientId: number }

// Cada escenario crea su empresa: la fixture compartida de Home debe seguir sin cuenta.
const test = base.extend<{ company: CreditCompany }>({
  company: async ({ request, playwright, baseURL }, use) => {
    const headers = { Origin: new URL(baseURL!).origin }
    const email = `credit-330-${randomUUID()}@e2e.test`
    const password = 'E2eLocal-214!'
    const cuit = '30-' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0') + '-9'
    const registered = await request.post('/api/auth/register', {
      headers,
      data: { tipoCliente: 'EMPRESA', nombreRazonSocial: 'Empresa E2E crédito #330', cuit, email, password },
    })
    expect(registered.status(), await registered.text()).toBe(201)

    const admin = await playwright.request.newContext({ baseURL })
    let clientId: number
    try {
      const login = await admin.post('/api/auth/login', {
        headers, data: { email: 'admin@e2e.test', password },
      })
      expect(login.ok(), await login.text()).toBe(true)
      const clients = await admin.get('/api/admin/clientes')
      expect(clients.ok(), await clients.text()).toBe(true)
      const company = ((await clients.json()).data.clientes as Array<{ id: number; email: string }>)
        .find(client => client.email === email)
      if (!company) throw new Error('La empresa propia del escenario no aparece en el listado ADMIN.')
      clientId = company.id
      const approval = await admin.patch(`/api/admin/clientes/${clientId}/estado-empresa`, {
        headers, data: { estado: 'APROBADA' },
      })
      expect(approval.status(), await approval.text()).toBe(200)
      const account = await admin.get(`/api/admin/clientes/${clientId}/cuenta-corriente`)
      expect(account.ok(), await account.text()).toBe(true)
      expect((await account.json()).data.estado).toBe('SIN_CUENTA')
    } finally {
      await admin.dispose()
    }

    // Las cuentas y su historial pertenecen a la base descartable del runner.
    await use({ email, clientId })
  },
})

for (const width of [1280, 360]) {
  test.describe(`Controles ADMIN de crédito a ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } })

    test('aprueba, administra la cuenta y rechaza otra solicitud', async ({
      page,
      request,
      baseURL,
      company,
    }) => {
      test.setTimeout(60_000)
      expect(baseURL).toBeTruthy()

      const origin = new URL(baseURL!).origin
      const headers = { Origin: origin }
      const password = 'E2eLocal-214!'

      // La sesión de empresa prepara solicitudes reales para el panel.
      const companyLogin = await request.post('/api/auth/login', {
        headers,
        data: { email: company.email, password },
      })
      expect(companyLogin.ok()).toBe(true)

      async function createRequest() {
        const response = await request.post('/api/cuenta-corriente/solicitudes', {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: { montoSolicitado: '1500.00', plazoDias: 30 },
        })
        expect(response.status(), await response.text()).toBe(201)

        const body = await response.json()
        return body.data.solicitud.id as number
      }

      const requestId = await createRequest()

      const adminLogin = await page.request.post('/api/auth/login', {
        headers,
        data: { email: 'admin@e2e.test', password },
      })
      expect(adminLogin.ok()).toBe(true)

      await page.goto('/admin/cuentas-corrientes')

      const requests = page.locator('section').filter({
        has: page.getByRole('heading', {
          name: 'Solicitudes de crédito pendientes',
          exact: true,
        }),
      }).last()

      await requests.getByRole('button', {
        name: `Aprobar solicitud ${requestId}`,
        exact: true,
      }).click()

      await requests.getByLabel('Límite autorizado (USD)', { exact: true }).fill('1500.00')
      await requests.getByLabel('Motivo', { exact: true }).fill('Aprobación de prueba #330')
      await requests.getByLabel('Evidencia comercial', { exact: true }).fill('TEST-ONLY #330')

      await requests.getByRole('button', {
        name: 'Confirmar aprobación',
        exact: true,
      }).click()

      await expect(
        requests.getByRole('status').filter({ hasText: 'Solicitud aprobada.' }),
      ).toBeVisible()

      const resolved = await page.request.get(`/api/admin/solicitudes-credito/${requestId}`)
      expect(resolved.ok()).toBe(true)
      const approved = (await resolved.json()).data.solicitud
      expect(approved.estado).toBe('APROBADA')
      expect(approved.clienteId).toBe(company.clientId)
      expect(approved.limiteAutorizado).toBe('1500.00')
      // Cada prueba comienza con la cuenta inhabilitada.
      const accountUrl = `/api/admin/clientes/${approved.clienteId}/cuenta-corriente`
      const accountResponse = await page.request.get(accountUrl)
      expect(accountResponse.ok()).toBe(true)
      const account = (await accountResponse.json()).data

      if (account.estado === 'HABILITADA') {
        const disabled = await page.request.post(`${accountUrl}/deshabilitar`, {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: { motivo: 'Preparación del escenario E2E #330' },
        })
        expect(disabled.status(), await disabled.text()).toBe(200)
      }

      await page.getByLabel('ID de cliente', { exact: true }).fill(String(approved.clienteId))
      await page.getByRole('button', { name: 'Consultar cliente por ID' }).click()

      const detail = page.getByRole('region', {
        name: `Cliente ${approved.clienteId}`,
        exact: true,
      })
      const limitValue = detail.locator('dl > div').filter({
        has: page.locator('dt').filter({ hasText: /^Límite$/ }),
      }).locator('dd')

      await expect(limitValue).toHaveText('USD 1.500,00')

      const controls = detail.locator('section').filter({
        has: page.getByRole('heading', { name: 'Gestión de crédito', exact: true }),
      })

      await expect(controls.getByRole('button', {
        name: 'Habilitar cuenta',
        exact: true,
      })).toBeVisible()

      await controls.getByRole('button', {
        name: 'Habilitar cuenta',
        exact: true,
      }).click()

      await controls.getByLabel('Evidencia comercial', { exact: true })
        .fill('TEST-ONLY habilitación inicial')

      await controls.getByRole('button', {
        name: 'Confirmar cambio',
        exact: true,
      }).click()

      await expect(
        detail.getByRole('status').filter({ hasText: 'Cuenta habilitada.' }),
      ).toBeVisible()

      await expect(controls.getByRole('button', {
        name: 'Deshabilitar cuenta',
        exact: true,
      })).toBeVisible()
      await controls.getByRole('button', {
        name: 'Deshabilitar cuenta',
        exact: true,
      }).click()
      await controls.getByLabel('Motivo', { exact: true }).fill('Suspensión de prueba')
      await controls.getByRole('button', { name: 'Confirmar cambio', exact: true }).click()
      await expect(
        detail.getByRole('status').filter({ hasText: 'Cuenta deshabilitada.' }),
      ).toBeVisible()
      await expect(controls.getByRole('button', {
        name: 'Habilitar cuenta',
        exact: true,
      })).toBeVisible()

      await controls.getByRole('button', { name: 'Habilitar cuenta', exact: true }).click()
      await controls.getByLabel('Evidencia comercial', { exact: true }).fill('TEST-ONLY habilitación')
      await controls.getByRole('button', { name: 'Confirmar cambio', exact: true }).click()
      await expect(
        detail.getByRole('status').filter({ hasText: 'Cuenta habilitada.' }),
      ).toBeVisible()
      await expect(controls.getByRole('button', {
        name: 'Deshabilitar cuenta',
        exact: true,
      })).toBeVisible()

      await controls.getByRole('button', { name: 'Editar límite', exact: true }).click()
      await controls.getByLabel('Nuevo límite (USD)', { exact: true }).fill('2000.00')
      await controls.getByLabel('Motivo', { exact: true }).fill('Ampliación de prueba')
      await controls.getByLabel('Evidencia comercial', { exact: true }).fill('TEST-ONLY límite')
      await controls.getByRole('button', { name: 'Confirmar cambio', exact: true }).click()

      await expect(
        detail.getByRole('status').filter({ hasText: 'Límite guardado.' }),
      ).toBeVisible()
      await expect(limitValue).toHaveText('USD 2.000,00')

      const rejectedId = await createRequest()
      await page.reload()
      await requests.getByRole('button', {
        name: `Rechazar solicitud ${rejectedId}`,
        exact: true,
      }).click()
      await requests.getByLabel('Motivo', { exact: true }).fill('Rechazo de prueba #330')
      await requests.getByRole('button', {
        name: 'Confirmar rechazo',
        exact: true,
      }).click()
      await expect(
        requests.getByRole('status').filter({ hasText: 'Solicitud rechazada.' }),
      ).toBeVisible()

      const rejected = await page.request.get(`/api/admin/solicitudes-credito/${rejectedId}`)
      expect(rejected.ok()).toBe(true)
      expect((await rejected.json()).data.solicitud.estado).toBe('RECHAZADA')

      expect(await page.evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth',
      )).toBe(true)
    })
  })
}
test('recupera una aprobación con respuesta perdida usando la misma clave', async ({
  page,
  request,
  baseURL,
  company,
}) => {
  const headers = { Origin: new URL(baseURL!).origin }
  const password = 'E2eLocal-214!'

  const companyLogin = await request.post('/api/auth/login', {
    headers,
    data: { email: company.email, password },
  })
  expect(companyLogin.ok()).toBe(true)

  const created = await request.post('/api/cuenta-corriente/solicitudes', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { montoSolicitado: '2000.00', plazoDias: 30 },
  })
  expect(created.status(), await created.text()).toBe(201)
  const requestId = (await created.json()).data.solicitud.id as number

  const adminLogin = await page.request.post('/api/auth/login', {
    headers,
    data: { email: 'admin@e2e.test', password },
  })
  expect(adminLogin.ok()).toBe(true)

  const keys: string[] = []
  const approvalPath = `/api/admin/solicitudes-credito/${requestId}/aprobar`

  await page.route(`**${approvalPath}`, async route => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')

    // Ejecuta la operación real y pierde solamente su primera respuesta.
    const response = await route.fetch()

    if (keys.length === 1) {
      expect(response.status()).toBe(200)
      await response.body()
      await route.abort('failed')
      return
    }

    await route.fulfill({ response })
  })

  await page.goto('/admin/cuentas-corrientes')

  const requests = page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Solicitudes de crédito pendientes',
      exact: true,
    }),
  }).last()

  await requests.getByRole('button', {
    name: `Aprobar solicitud ${requestId}`,
    exact: true,
  }).click()

  const limit = requests.getByLabel('Límite autorizado (USD)', { exact: true })
  await limit.fill('2000.00')
  await requests.getByLabel('Motivo', { exact: true }).fill('Prueba de recuperación')
  await requests.getByLabel('Evidencia comercial', { exact: true }).fill('TEST-ONLY #330')

  await requests.getByRole('button', {
    name: 'Confirmar aprobación',
    exact: true,
  }).click()

  await expect(requests.getByRole('alert')).toContainText(
    'No pudimos confirmar el resultado',
  )
  await expect(limit).toBeDisabled()
  await expect(limit).toHaveValue('2000.00')

  await requests.getByRole('button', {
    name: 'Reintentar operación',
    exact: true,
  }).click()

  await expect(
    requests.getByRole('status').filter({ hasText: 'Solicitud aprobada.' }),
  ).toBeVisible()

  expect(keys).toHaveLength(2)
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])

  const result = await page.request.get(`/api/admin/solicitudes-credito/${requestId}`)
  expect(result.ok()).toBe(true)

  const approved = (await result.json()).data.solicitud
  expect(approved.estado).toBe('APROBADA')
  expect(approved.clienteId).toBe(company.clientId)
  expect(approved.limiteAutorizado).toBe('2000.00')
})

test('conserva el formulario al rechazar un límite inferior a la deuda', async ({
  page,
  baseURL,
}) => {
  const accounts: Record<string, number> = JSON.parse(
    process.env.E2E_ADMIN_ACCOUNTS ?? '{}',
  )
  const clientId = accounts.debt
  expect(clientId, 'El runner debe preparar la cuenta con deuda').toBeGreaterThan(0)

  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: new URL(baseURL!).origin },
    data: { email: 'admin@e2e.test', password: 'E2eLocal-214!' },
  })
  expect(login.ok()).toBe(true)

  await page.goto('/admin/cuentas-corrientes')
  await page.getByLabel('ID de cliente', { exact: true }).fill(String(clientId))
  await page.getByRole('button', { name: 'Consultar cliente por ID' }).click()

  const detail = page.getByRole('region', {
    name: `Cliente ${clientId}`,
    exact: true,
  })
  const controls = detail.locator('section').filter({
    has: page.getByRole('heading', { name: 'Gestión de crédito', exact: true }),
  })

  await controls.getByRole('button', { name: 'Editar límite', exact: true }).click()

  const limit = controls.getByLabel('Nuevo límite (USD)', { exact: true })
  const reason = controls.getByLabel('Motivo', { exact: true })
  const evidence = controls.getByLabel('Evidencia comercial', { exact: true })

  await limit.fill('0.00')
  await reason.fill('Revisión del límite #330')
  await evidence.fill('TEST-ONLY revisión')

  const rejectedResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname ===
      `/api/admin/clientes/${clientId}/cuenta-corriente/limite`
    && response.request().method() === 'PUT',
  )

  await controls.getByRole('button', { name: 'Confirmar cambio', exact: true }).click()

  const rejected = await rejectedResponse
  expect(rejected.status()).toBe(409)
  expect((await rejected.json()).code).toBe('LIMITE_POR_DEBAJO_DE_DEUDA')

  await expect(controls.getByRole('alert')).toContainText(
    'El nuevo límite no puede ser inferior al crédito utilizado',
  )
  await expect(limit).toBeEnabled()
  await expect(limit).toHaveValue('0.00')
  await expect(reason).toHaveValue('Revisión del límite #330')
  await expect(evidence).toHaveValue('TEST-ONLY revisión')

  await limit.fill('1000.00')
  await controls.getByRole('button', { name: 'Confirmar cambio', exact: true }).click()

  await expect(
    detail.getByRole('status').filter({ hasText: 'Límite guardado.' }),
  ).toBeVisible()
})