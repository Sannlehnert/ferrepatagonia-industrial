import { expect, test, type Page } from '@playwright/test'

const request = (id: number, estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' = 'PENDIENTE') => ({
  id, estado, montoSolicitado: '1000.00', plazoDias: 30, moneda: 'USD',
  observaciones: null, fechaSolicitud: '2026-11-18T12:00:00.000Z',
  fechaResolucion: null, limiteAutorizado: null, plazoAutorizado: null,
})

async function setup(page: Page) {
  await page.route('**/socket.io/**', route => route.abort())
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('empresa-cuenta@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/mi-cuenta$/)
}

async function fillRequest(page: Page, amount = '1000') {
  await page.getByLabel('Monto solicitado (USD)').fill(amount)
  await page.getByLabel('Observaciones (opcional)').fill('Prueba')
}

for (const outcome of ['success', 'failure'] as const) {
  test(`descarta respuesta tardía ${outcome} al cambiar de sesión`, async ({ page }) => {
    await setup(page)
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let started = () => {}
    const posting = new Promise<void>(resolve => { started = resolve })
    const keys: string[] = []
    let sessionB = false
    await page.route('**/api/auth/me', route => sessionB
      ? route.fulfill({ json: { user: {
        id: 999, nombre: 'Empresa B', email: 'b@example.test', rol: 'CLIENTE',
        tipo_cliente: 'EMPRESA', estadoAprobacionEmpresa: 'APROBADA', cuentaCorrienteHabilitada: false,
      } } })
      : route.continue())
    await page.route('**/api/cuenta-corriente/solicitudes**', async route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { data: { items: [], siguienteAntesDeId: null } } })
      }
      keys.push(route.request().headers()['idempotency-key']!)
      if (keys.length === 1) {
        started()
        await gate
        if (outcome === 'failure') {
          return route.fulfill({ status: 503, json: { message: 'Error de la sesión anterior' } })
        }
        return route.fulfill({ status: 201, json: { data: { solicitud: request(101) } } })
      }
      return route.fulfill({ status: 201, json: { data: { solicitud: request(202) } } })
    })
    try {
      await page.goto('/mi-cuenta/cuenta-corriente')
      await fillRequest(page)
      await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
      await posting
      sessionB = true
      await page.evaluate(() => {
        const channel = new BroadcastChannel('ferrepatagonia-session')
        channel.postMessage('session-changed')
        channel.close()
      })
      await expect(page.getByLabel('Monto solicitado (USD)')).toHaveValue('')
      await expect(page.getByRole('button', { name: 'Solicitar crédito', exact: true })).toBeEnabled()
      const oldResponse = page.waitForResponse(response =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/cuenta-corriente/solicitudes')
      release()
      await oldResponse
      await expect(page.getByText('Solicitud #101 · Pendiente')).toHaveCount(0)
      await expect(page.getByText('Error de la sesión anterior')).toHaveCount(0)
      await expect(page.getByLabel('Monto solicitado (USD)')).toHaveValue('')
      await fillRequest(page, '2000')
      await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
      await expect(page.getByText('Solicitud #202 · Pendiente')).toBeVisible()
      await expect(page.getByText('Solicitud #101 · Pendiente')).toHaveCount(0)
      await expect(page.getByText('Error de la sesión anterior')).toHaveCount(0)
      expect(keys).toHaveLength(2)
      expect(keys[1]).not.toBe(keys[0])
    } finally {
      release()
    }
  })
}

for (const status of [400, 422]) {
  test(`un rechazo ${status} permite corregir y enviar con otra clave`, async ({ page }) => {
    await setup(page)
    const keys: string[] = []
    await page.route('**/api/cuenta-corriente/solicitudes**', async route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { data: { items: [], siguienteAntesDeId: null } } })
      }
      keys.push(route.request().headers()['idempotency-key']!)
      return keys.length === 1
        ? route.fulfill({ status, json: { message: 'Corregí los datos.' } })
        : route.fulfill({ status: 201, json: { data: { solicitud: request(303) } } })
    })
    await page.goto('/mi-cuenta/cuenta-corriente')
    await fillRequest(page)
    await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Corregí los datos.' })).toBeVisible()
    await expect(page.getByLabel('Monto solicitado (USD)')).toBeEnabled()
    await fillRequest(page, '2000')
    await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
    await expect(page.getByText('Solicitud #303 · Pendiente')).toBeVisible()
    expect(keys[1]).not.toBe(keys[0])
  })
}

test('no reutiliza un intento incierto de otra sesión', async ({ page }) => {
  await setup(page)
  let sessionB = false
  const keys: string[] = []
  await page.route('**/api/auth/me', route => sessionB
    ? route.fulfill({ json: { user: {
      id: 999, nombre: 'Empresa B', email: 'b@example.test', rol: 'CLIENTE',
      tipo_cliente: 'EMPRESA', estadoAprobacionEmpresa: 'APROBADA', cuentaCorrienteHabilitada: false,
    } } })
    : route.continue())
  await page.route('**/api/cuenta-corriente/solicitudes**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { data: { items: [], siguienteAntesDeId: null } } })
    }
    keys.push(route.request().headers()['idempotency-key']!)
    return keys.length === 1
      ? route.fulfill({ status: 503, json: { code: 'RESULTADO_DESCONOCIDO' } })
      : route.fulfill({ status: 201, json: { data: { solicitud: request(707) } } })
  })
  await page.goto('/mi-cuenta/cuenta-corriente')
  await fillRequest(page)
  await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reintentar envío' })).toBeVisible()
  sessionB = true
  await page.evaluate(() => {
    const channel = new BroadcastChannel('ferrepatagonia-session')
    channel.postMessage('session-changed')
    channel.close()
  })
  await expect(page.getByLabel('Monto solicitado (USD)')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Solicitar crédito', exact: true })).toBeEnabled()
  await fillRequest(page, '2000')
  await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
  await expect(page.getByText('Solicitud #707 · Pendiente')).toBeVisible()
  expect(keys[1]).not.toBe(keys[0])
})

test('reconcilia un conflicto de solicitud pendiente', async ({ page }) => {
  await setup(page)
  let pending = false
  await page.route('**/api/cuenta-corriente/solicitudes**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { data: { items: pending ? [request(404)] : [], siguienteAntesDeId: null } } })
    }
    pending = true
    return route.fulfill({ status: 409, json: { code: 'SOLICITUD_PENDIENTE', message: 'Ya existe una solicitud pendiente.' } })
  })
  await page.goto('/mi-cuenta/cuenta-corriente')
  await fillRequest(page)
  await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
  await expect(page.getByText('Solicitud #404 · Pendiente')).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Ya existe una solicitud pendiente.' })).toBeVisible()
  pending = false
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await expect(page.getByLabel('Monto solicitado (USD)')).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Solicitar crédito', exact: true })).toBeVisible()
})

for (const status of [503, 409, 'network'] as const) {
  test(`conserva clave y datos ante resultado incierto ${status}`, async ({ page }) => {
    await setup(page)
    const attempts: Array<{ key: string; body: unknown }> = []
    await page.route('**/api/cuenta-corriente/solicitudes**', async route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { data: { items: [], siguienteAntesDeId: null } } })
      }
      attempts.push({ key: route.request().headers()['idempotency-key']!, body: route.request().postDataJSON() })
      if (attempts.length > 1) {
        return route.fulfill({ status: 200, json: { data: { solicitud: request(505) } } })
      }
      if (status === 'network') return route.abort('timedout')
      return route.fulfill({ status, json: { code: status === 409 ? 'CONFLICTO_CONCURRENCIA' : 'RESULTADO_DESCONOCIDO' } })
    })
    await page.goto('/mi-cuenta/cuenta-corriente')
    await fillRequest(page)
    await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
    await expect(page.getByLabel('Monto solicitado (USD)')).toBeDisabled()
    await page.getByRole('button', { name: 'Reintentar envío' }).click()
    await expect(page.getByText('Solicitud #505 · Pendiente')).toBeVisible()
    expect(attempts[1]).toEqual(attempts[0])
  })
}

test('una consulta anterior al envío no reemplaza la solicitud recién creada', async ({ page }) => {
  await setup(page)
  let reads = 0
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let readStarted = () => {}
  const reading = new Promise<void>(resolve => { readStarted = resolve })
  let releasePost = () => {}
  const postGate = new Promise<void>(resolve => { releasePost = resolve })
  await page.route('**/api/cuenta-corriente/solicitudes**', async route => {
    if (route.request().method() === 'GET') {
      if (++reads === 2) {
        readStarted()
        await gate
      }
      return route.fulfill({ json: { data: { items: [], siguienteAntesDeId: null } } })
    }
    return route.fulfill({ status: 201, json: { data: { solicitud: request(606) } } })
  })
  try {
    await page.goto('/mi-cuenta/cuenta-corriente')
    await fillRequest(page)
    await page.route('**/api/cuenta-corriente/solicitudes', async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      await postGate
      return route.fulfill({ status: 201, json: { data: { solicitud: request(606) } } })
    })
    await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    await reading
    releasePost()
    await expect(page.getByText('Solicitud #606 · Pendiente')).toBeVisible()
    const oldRead = page.waitForResponse(response =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/cuenta-corriente/solicitudes')
    release()
    await oldRead
    await expect(page.getByText('Solicitud #606 · Pendiente')).toBeVisible()
  } finally {
    release()
    releasePost()
  }
})
