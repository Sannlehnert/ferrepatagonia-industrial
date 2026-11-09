import { expect, test, type Page } from '@playwright/test'

test.beforeEach(() => {
  test.skip(
    process.env.E2E_PRODUCTION_BUILD !== '1',
    'Este escenario requiere el build de producción.',
  )
})

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('cliente@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible()
}

const summary = {
  corte: '2026-11-09T12:00:00Z',
  revision: 'r1',
  estado: 'HABILITADA',
  cuentaId: 1,
  origen: 'REAL',
  moneda: 'USD',
  plazoDias: 30,
  saldo: '100.00',
  limite: '500.00',
  utilizado: '400.00',
  disponible: '100.00',
  deudaVencidaTotal: '0.00',
  deudaVencida30Dias: '0.00',
  deudaVencida60Dias: '0.00',
  deudaPorVencerTotal: '0.00',
  cobertura: 'COMPLETA',
  estadoCredito: 'DISPONIBLE',
}

function page(items: unknown[] = []) {
  return {
    corte: '2026-11-09T12:00:00Z',
    revision: 'r1',
    estado: 'HABILITADA',
    cobertura: 'COMPLETA',
    items,
    siguienteCursor: null,
  }
}

test('production build blocks mixed REAL/DEMO data while loading and after verification', async ({ page: browser }) => {
  await signIn(browser)

  let releaseMovements!: () => void
  const movementsReady = new Promise<void>(resolve => {
    releaseMovements = resolve
  })
  await browser.route('**/api/cuenta-corriente**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/cuenta-corriente') {
      return route.fulfill({ json: { data: summary } })
    }
    if (path === '/api/cuenta-corriente/movimientos') {
      await movementsReady
      return route.fulfill({
        json: {
          data: page([{
            id: 'm-demo',
            fechaOperacion: '2026-11-09T12:00:00Z',
            concepto: 'Movimiento de demostración',
            importe: '20.00',
            saldoResultante: '100.00',
            moneda: 'USD',
            tipo: 'CARGO',
            estado: 'VIGENTE',
            venceEl: null,
            plazoDias: 30,
            origen: 'DEMO',
            referencia: { pedidoId: 1 },
          }]),
        },
      })
    }
    return route.fulfill({ json: { data: page() } })
  })

  await browser.goto('/mi-cuenta/cuenta-corriente')
  await expect(browser.getByRole('status')).toContainText('Consultando')
  await expect(browser.getByText('Saldo actual (USD)')).toHaveCount(0)
  await expect(browser.getByText(/US\$/)).toHaveCount(0)

  releaseMovements()
  await expect(browser.getByRole('alert')).toContainText(
    'no se mostrará fuera del entorno de pruebas',
  )
  await expect(browser.getByText('Saldo actual (USD)')).toHaveCount(0)
  await expect(browser.getByText(/US\$/)).toHaveCount(0)
})

test('production build oculta todas las cifras cuando falla una consulta de procedencia', async ({ page: browser }) => {
  await signIn(browser)
  await browser.route('**/api/cuenta-corriente**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/cuenta-corriente') {
      return route.fulfill({ json: { data: summary } })
    }
    if (path === '/api/cuenta-corriente/vencimientos') {
      return route.fulfill({
        status: 503,
        json: { code: 'TEMPORAL', message: 'Servicio temporalmente no disponible.' },
      })
    }
    return route.fulfill({ json: { data: page() } })
  })

  await browser.goto('/mi-cuenta/cuenta-corriente')
  await expect(browser.getByRole('alert')).toContainText(
    'No se pudieron verificar todos los datos financieros',
  )
  await expect(browser.getByText('Saldo actual (USD)')).toHaveCount(0)
  await expect(browser.getByText(/US\$/)).toHaveCount(0)
})

test('production build consulta cuenta no habilitada al backend real de MariaDB', async ({ page: browser }) => {
  await signIn(browser)
  await browser.goto('/mi-cuenta/cuenta-corriente')
  await expect(browser.getByRole('status')).toContainText(
    'No tenés una cuenta corriente asociada.',
  )
})
