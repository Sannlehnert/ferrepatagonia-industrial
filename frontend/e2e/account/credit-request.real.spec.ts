import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('empresa consulta las decisiones de ADMIN sin recargar la página', async ({ page, playwright, baseURL }) => {
  test.setTimeout(60_000)
  const origin = new URL(baseURL!).origin
  const headers = { Origin: origin }
  const password = 'E2eLocal-214!'
  const email = `credit-331-${randomUUID()}@e2e.test`
  const admin = await playwright.request.newContext({ baseURL })
  const registration = await playwright.request.newContext({ baseURL })
  try {
    const registered = await registration.post('/api/auth/register', {
      headers,
      data: {
        tipoCliente: 'EMPRESA', nombreRazonSocial: 'Empresa E2E crédito #331',
        cuit: '30-' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0') + '-9',
        email, password,
      },
    })
    expect(registered.status(), await registered.text()).toBe(201)
    const login = await admin.post('/api/auth/login', {
      headers, data: { email: 'admin@e2e.test', password },
    })
    expect(login.ok(), await login.text()).toBe(true)
    const clients = await admin.get('/api/admin/clientes')
    const company = ((await clients.json()).data.clientes as Array<{ id: number; email: string }>)
      .find(client => client.email === email)
    if (!company) throw new Error('No se encontró la empresa creada para la prueba.')
    const approval = await admin.patch(`/api/admin/clientes/${company.id}/estado-empresa`, {
      headers, data: { estado: 'APROBADA' },
    })
    expect(approval.status(), await approval.text()).toBe(200)

    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel(/^Contraseña/).fill(password)
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
    await expect(page).toHaveURL(/\/mi-cuenta$/)
    await page.goto('/mi-cuenta/cuenta-corriente')

    async function submit() {
      await page.getByLabel('Monto solicitado (USD)').fill('1500')
      const created = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/cuenta-corriente/solicitudes' &&
        response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
      const response = await created
      expect(response.status()).toBe(201)
      const id: number = (await response.json()).data.solicitud.id
      await expect(page.getByText(`Solicitud #${id} · Pendiente`)).toBeVisible()
      return id
    }

    const rejectedId = await submit()
    const rejected = await admin.post(`/api/admin/solicitudes-credito/${rejectedId}/rechazar`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: { motivo: 'Rechazo de prueba' },
    })
    expect(rejected.status(), await rejected.text()).toBe(200)
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    await expect(page.getByText(`Solicitud #${rejectedId} · Rechazada`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Solicitar crédito', exact: true })).toBeVisible()

    const approvedId = await submit()
    const approved = await admin.post(`/api/admin/solicitudes-credito/${approvedId}/aprobar`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: { limiteAutorizado: '1500.00', plazoDias: 30, motivo: 'Aprobación de prueba', evidencia: 'TEST-ONLY #331' },
    })
    expect(approved.status(), await approved.text()).toBe(200)
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    await expect(page.getByText(`Solicitud #${approvedId} · Aprobada`)).toBeVisible()
    await expect(page.getByText('La cuenta está inhabilitada.', { exact: false })).toBeVisible()
    const account = await admin.get(`/api/admin/clientes/${company.id}/cuenta-corriente`)
    expect((await account.json()).data.estado).toBe('INHABILITADA')
  } finally {
    await registration.dispose()
    await admin.dispose()
  }
})
