import { expect, test, type Page } from '@playwright/test'

type ClientType = 'PARTICULAR' | 'EMPRESA'

function initialProfile(tipoCliente: ClientType) {
  return {
    id: 21,
    tipoCliente,
    nombreRazonSocial: tipoCliente === 'EMPRESA' ? 'Ferretería Patagonia S.R.L.' : 'Ana Cliente',
    email: 'cliente@example.test',
    docCliente: tipoCliente === 'PARTICULAR' ? '30111222' : null,
    cuit: tipoCliente === 'EMPRESA' ? '30-71234567-8' : null,
    telefono: '294 400 0000',
    direccion: 'Ruta 40 km 1',
    estadoAprobacionEmpresa: tipoCliente === 'EMPRESA' ? 'APROBADA' : null,
    cuentaCorrienteHabilitada: tipoCliente === 'EMPRESA' ? true : null,
  }
}

async function setup(page: Page, tipoCliente: ClientType) {
  let authenticated = false
  let profile = initialProfile(tipoCliente)
  let failNextUpdate = false
  const updates: Array<Record<string, unknown>> = []

  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/login') {
      authenticated = true
      return route.fulfill({ json: { user: {
        id: 21,
        nombre: profile.nombreRazonSocial,
        email: profile.email,
        rol: 'CLIENTE',
        tipo_cliente: tipoCliente,
        estadoAprobacionEmpresa: profile.estadoAprobacionEmpresa,
        cuentaCorrienteHabilitada: profile.cuentaCorrienteHabilitada,
      } } })
    }
    if (path === '/api/auth/me') {
      return authenticated ? route.fulfill({ json: { user: {
        id: 21,
        nombre: profile.nombreRazonSocial,
        email: profile.email,
        rol: 'CLIENTE',
        tipo_cliente: tipoCliente,
        estadoAprobacionEmpresa: profile.estadoAprobacionEmpresa,
        cuentaCorrienteHabilitada: profile.cuentaCorrienteHabilitada,
      } } }) : route.fulfill({ status: 401, json: { message: 'No autenticado.' } })
    }
    if (path === '/api/auth/logout') {
      authenticated = false
      return route.fulfill({ json: {} })
    }
    if (path === '/api/perfil' && request.method() === 'GET') {
      return route.fulfill({ json: { data: { perfil: profile } } })
    }
    if (path === '/api/perfil' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>
      updates.push(body)
      if (failNextUpdate) {
        failNextUpdate = false
        return route.fulfill({ status: 503, json: { message: 'No se pudo confirmar el guardado.' } })
      }
      profile = { ...profile, ...body }
      return route.fulfill({ json: { message: 'Perfil actualizado.', data: { perfil: profile } } })
    }
    return route.fulfill({ json: { data: { items: [] } } })
  })

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('cliente@example.test')
  await page.getByLabel(/^Contraseña/).fill('clave')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/mi-cuenta$/)
  await page.goto('/mi-cuenta/datos')
  await expect(page.getByLabel('Teléfono')).toHaveValue('294 400 0000')
  return {
    updates,
    failUpdate() { failNextUpdate = true },
  }
}

for (const tipoCliente of ['PARTICULAR', 'EMPRESA'] as const) {
  test(`${tipoCliente}: consulta y guarda solo los datos de contacto permitidos`, async ({ page }) => {
    const state = await setup(page, tipoCliente)
    await expect(page.getByText(tipoCliente === 'EMPRESA' ? 'Ferretería Patagonia S.R.L.' : 'Ana Cliente')).toBeVisible()
    await expect(page.getByText(tipoCliente === 'EMPRESA' ? '30-71234567-8' : '30111222')).toBeVisible()
    if (tipoCliente === 'EMPRESA') {
      await expect(page.getByText('APROBADA')).toBeVisible()
      await expect(page.getByText('Habilitada')).toBeVisible()
    }

    await page.getByLabel('Teléfono').fill('294 411 2233')
    await page.getByLabel('Dirección').fill('Av. Patagonia 123')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('status')).toHaveText('Tus datos se guardaron correctamente.')
    await expect(page.getByLabel('Teléfono')).toHaveValue('294 411 2233')
    await expect(page.getByLabel('Dirección')).toHaveValue('Av. Patagonia 123')
    expect(state.updates).toEqual([{ telefono: '294 411 2233', direccion: 'Av. Patagonia 123' }])

    await page.goto('/mi-cuenta')
    await page.goto('/mi-cuenta/datos')
    await expect(page.getByLabel('Teléfono')).toHaveValue('294 411 2233')
    await expect(page.getByLabel('Dirección')).toHaveValue('Av. Patagonia 123')

    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    }
  })
}

test('mantiene los cambios en el formulario y permite reintentar tras un error', async ({ page }) => {
  const state = await setup(page, 'PARTICULAR')
  await page.getByLabel('Teléfono').fill('1'.repeat(51))
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('El teléfono admite hasta 50 caracteres.')).toBeVisible()
  await expect(page.getByLabel('Teléfono')).toHaveAttribute('aria-invalid', 'true')
  expect(state.updates).toEqual([])

  state.failUpdate()
  await page.getByLabel('Teléfono').fill('294 499 8877')
  await page.getByLabel('Dirección').fill('Calle nueva 45')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page.getByRole('alert')).toHaveText('No se pudo confirmar el guardado.')
  await expect(page.getByLabel('Teléfono')).toHaveValue('294 499 8877')
  await expect(page.getByLabel('Dirección')).toHaveValue('Calle nueva 45')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByRole('status')).toHaveText('Tus datos se guardaron correctamente.')
  expect(state.updates).toEqual([
    { telefono: '294 499 8877', direccion: 'Calle nueva 45' },
    { telefono: '294 499 8877', direccion: 'Calle nueva 45' },
  ])
})
