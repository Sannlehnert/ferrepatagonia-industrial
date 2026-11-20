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

for (const width of [360, 768, 1280]) {
  test(`controles de crédito son visibles y conservan foco a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await setup(page)
    await page.route('**/api/cuenta-corriente/solicitudes**', route =>
      route.fulfill({ json: { data: { items: [], siguienteAntesDeId: null } } }))
    await page.goto('/mi-cuenta/cuenta-corriente')
    const amount = page.getByLabel('Monto solicitado (USD)')
    const term = page.getByLabel('Plazo solicitado')
    const notes = page.getByLabel('Observaciones (opcional)')
    const submit = page.getByRole('button', { name: 'Solicitar crédito', exact: true })
    const refresh = page.getByRole('button', { name: 'Actualizar', exact: true })
    await expect(amount).toBeVisible()

    const font = await page.locator('body').evaluate(element =>
      element.ownerDocument.defaultView!.getComputedStyle(element).fontFamily)
    for (const control of [amount, term, notes]) {
      await expect(control).toHaveCSS('box-sizing', 'border-box')
      await expect(control).toHaveCSS('font-family', font)
      await expect(control).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      const fits = await control.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const parent = element.parentElement!.getBoundingClientRect()
        return bounds.left >= parent.left && bounds.right <= parent.right + 0.5
      })
      expect(fits).toBe(true)
    }
    if (width >= 768) {
      const amountBounds = (await amount.boundingBox())!
      const termBounds = (await term.boundingBox())!
      expect(termBounds.x - (amountBounds.x + amountBounds.width)).toBeGreaterThanOrEqual(15)
    }
    await expect(term).toHaveCSS('cursor', 'pointer')
    for (const button of [submit, refresh]) {
      await expect(button).toHaveCSS('box-sizing', 'border-box')
      await expect(button).toHaveCSS('font-family', font)
      await expect(button).toHaveCSS('cursor', 'pointer')
    }
    await expect(submit).toHaveCSS('border-top-width', '0px')
    await expect(refresh).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.keyboard.press('Tab')
    for (const control of [amount, term, notes, submit, refresh]) {
      await control.focus()
      expect(await control.evaluate(element => element.matches(':focus-visible'))).toBe(true)
      await expect(control).toHaveCSS('outline-width', '2px')
      await expect(control).toHaveCSS('outline-offset', '2px')
      await expect(control).toHaveCSS('outline-color', 'rgb(20, 90, 141)')
    }
    await amount.focus()
    for (const control of [term, notes, submit]) {
      await page.keyboard.press('Tab')
      await expect(control).toBeFocused()
    }
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  })
}

test('controles deshabilitados y reintento de consulta mantienen estilos explícitos', async ({ page }) => {
  await setup(page)
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let releaseAccount = () => {}
  const accountGate = new Promise<void>(resolve => { releaseAccount = resolve })
  let failRead = true
  await page.route('**/api/cuenta-corriente/solicitudes**', async route => {
    if (route.request().method() === 'GET') {
      return failRead
        ? route.fulfill({ status: 503, json: { message: 'No disponible' } })
        : route.fulfill({ json: { data: { items: [], siguienteAntesDeId: null } } })
    }
    await gate
    return route.fulfill({ status: 201, json: { data: { solicitud: request(808) } } })
  })
  try {
    await page.goto('/mi-cuenta/cuenta-corriente')
    const retry = page.getByRole('button', { name: 'Reintentar consulta', exact: true })
    await expect(retry).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(retry).toHaveCSS('cursor', 'pointer')
    await page.keyboard.press('Tab')
    await retry.focus()
    await expect(retry).toHaveCSS('outline-width', '2px')
    await expect(retry).toHaveCSS('outline-offset', '2px')
    await expect(retry).toHaveCSS('outline-color', 'rgb(20, 90, 141)')
    failRead = false
    await retry.click()
    const refresh = page.getByRole('button', { name: 'Actualizar', exact: true })
    await expect(refresh).toBeEnabled()
    await page.route('**/api/cuenta-corriente', async route => {
      await accountGate
      await route.continue()
    }, { times: 1 })
    await refresh.click()
    const updating = page.getByRole('button', { name: 'Actualizando…', exact: true })
    await expect(updating).toBeDisabled()
    await expect(updating).toHaveCSS('cursor', 'not-allowed')
    await expect(updating).toHaveCSS('opacity', '0.6')
    releaseAccount()
    await expect(refresh).toBeEnabled()
    await fillRequest(page)
    await page.getByRole('button', { name: 'Solicitar crédito', exact: true }).click()
    for (const control of [
      page.getByLabel('Monto solicitado (USD)'),
      page.getByLabel('Plazo solicitado'),
      page.getByLabel('Observaciones (opcional)'),
      page.getByRole('button', { name: 'Enviando…', exact: true }),
    ]) {
      await expect(control).toBeDisabled()
      await expect(control).toHaveCSS('cursor', 'not-allowed')
    }
    release()
    await expect(page.getByText('Solicitud #808 · Pendiente')).toBeVisible()
  } finally {
    release()
    releaseAccount()
  }
})

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
