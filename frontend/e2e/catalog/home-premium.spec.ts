import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<{
    connection: {
      query<T>(sql: string, params?: unknown[]): Promise<T>
      end(): Promise<void>
    }
  }>
}

const business = (page: Page) => page.getByRole('region', { name: 'Ferrepatagonia para empresas' })
const categories = (page: Page) => page.getByRole('region', { name: 'Categorías del catálogo' })
const products = (page: Page) => page.getByRole('region', { name: 'Explorá nuestros productos' })
const header = (page: Page) => page.getByRole('banner')

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/(admin\/dashboard|mi-cuenta\/datos)$/)
}

test('Home usa categorías, búsqueda y detalle del catálogo real', async ({ page }) => {
  await page.goto('/')
  const search = header(page).getByRole('searchbox', { name: 'Buscar productos por nombre o código' })
  await expect(header(page).getByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/login')
  await expect(header(page).getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('href', '/registro')
  await expect(header(page).getByRole('button', { name: 'Carrito', exact: true })).toHaveCount(0)
  await expect(header(page).getByRole('link', { name: 'Panel de administración' })).toHaveCount(0)
  await expect(business(page).getByRole('link', { name: 'Registrá tu empresa' })).toHaveAttribute('href', '/registro?tipo=empresa')
  await expect(business(page)).toContainText('sujetas a evaluación y habilitación')

  await header(page).getByRole('link', { name: 'Categorías' }).click()
  await expect(page).toHaveURL(/\/#categorias$/)
  await categories(page).getByRole('link', { name: 'Fijaciones E2E' }).click()
  await expect(page).toHaveURL(/\/catalogo\?categoria=2$/)
  await expect(page.getByRole('heading', { name: 'Producto E2E 24', exact: true })).toBeVisible()

  for (const term of ['Producto E2E 24', 'E2E-24']) {
    await search.fill(term)
    await search.press('Enter')
    await expect.poll(() => new URL(page.url()).searchParams.get('busqueda')).toBe(term)
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Producto E2E 24'])
  }

  await header(page).getByRole('link', { name: /Ferrepatagonia Industrial/ }).click()
  const link = products(page).getByRole('link', { name: 'Ver producto: Producto E2E 01' })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(/\/producto\/1\?returnTo=/)
  await expect(page.getByRole('heading', { name: 'Producto E2E 01', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Volver al inicio' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('Home de particular muestra su acceso y abre el carrito real', async ({ page }) => {
  await signIn(page, 'cliente-nuevo@e2e.test')
  await page.goto('/')
  await expect(header(page).getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/mi-cuenta/datos')
  await expect(header(page).getByRole('link', { name: 'Panel de administración' })).toHaveCount(0)
  await expect(business(page)).toContainText('cuenta particular')
  const cart = header(page).getByRole('button', { name: 'Carrito', exact: true })
  await cart.click()
  const drawer = page.getByRole('dialog', { name: 'Tu carrito' })
  await expect(drawer).toBeVisible()
  await expect(cart).toHaveAttribute('aria-expanded', 'true')
  await drawer.getByRole('button', { name: 'Cerrar carrito' }).click()
  await expect(cart).toBeFocused()
})

test('Home de administración muestra solo accesos de su rol', async ({ page }) => {
  await signIn(page, 'admin@e2e.test')
  await page.goto('/')
  await expect(header(page).getByRole('link', { name: 'Panel de administración' })).toHaveAttribute('href', '/admin/dashboard')
  await expect(header(page).getByRole('button', { name: 'Carrito', exact: true })).toHaveCount(0)
  await business(page).getByRole('link', { name: 'Gestionar cuentas' }).click()
  await expect(page).toHaveURL(/\/admin\/cuentas-corrientes$/)
})

test('empresa aprobada sin cuenta en la base aislada recibe un acceso de consulta', async ({ page }) => {
  await signIn(page, 'empresa-cuenta@e2e.test')
  const summary = page.waitForResponse(response => response.url().endsWith('/api/cuenta-corriente'))
  await page.goto('/')
  expect((await (await summary).json()).data.estado).toBe('SIN_CUENTA')
  await expect(business(page).getByRole('link', { name: 'Consultar estado de cuenta' })).toHaveAttribute('href', '/mi-cuenta/cuenta-corriente')
  await expect(business(page)).not.toContainText('Tu cuenta corriente está habilitada')
})

test('empresa con cuenta habilitada recibe el acceso directo sin importes', async ({ page }) => {
  const profile = process.env.CCE2E_TEST_PROFILE
  if (!profile) throw new Error('Ejecutá las pruebas con el runner E2E aislado')
  const { connection } = await connectOwned(JSON.parse(profile), 'E2E')
  let accountId: bigint | undefined
  try {
    const result = await connection.query<{ insertId: bigint }>(`
      INSERT INTO CUENTA_CORRIENTE (
        id_cliente, limite_credito, habilitada, cobertura, plazo_dias, moneda_limite,
        evidencia_limite, evidencia_plazo, evidencia_cobertura, cobertura_desde_utc, origen_datos
      )
      SELECT id_cliente, 1337.00, 1, 'COMPLETA', 30, 'USD',
        'TEST-ONLY E2E', 'TEST-ONLY E2E', 'TEST-ONLY E2E',
        UTC_TIMESTAMP(3) - INTERVAL 1 DAY, 'DEMO'
      FROM CLIENTE WHERE email = ? AND estado_aprobacion_empresa = 'APROBADA'
    `, ['empresa-cuenta@e2e.test'])
    accountId = result.insertId

    await signIn(page, 'empresa-cuenta@e2e.test')
    await page.goto('/')
    await expect(business(page).getByRole('link', { name: 'Ver cuenta corriente' })).toHaveAttribute('href', '/mi-cuenta/cuenta-corriente')
    await expect(business(page)).toContainText('Tu cuenta corriente está habilitada')
    await expect(business(page)).not.toContainText('1337.00')
  } finally {
    try {
      if (accountId) await connection.query('DELETE FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [accountId])
    } finally {
      await connection.end()
    }
  }
})

test('Home separa carga, error, reintento y vacío de catálogo y categorías', async ({ page }) => {
  let release: () => void = () => {}
  const firstResponse = new Promise<void>(resolve => { release = resolve })
  const paths = ['**/api/catalogo?*', '**/api/categorias']
  for (const path of paths) {
    await page.route(path, async route => {
      await firstResponse
      await route.fulfill({ status: 500, json: { message: 'Error de prueba' } })
    }, { times: 1 })
  }

  try {
    await page.goto('/')
    await expect(categories(page).getByRole('status')).toHaveText('Cargando categorías…')
    await expect(products(page).getByRole('status')).toHaveText('Cargando productos…')
  } finally {
    release()
  }

  await expect(categories(page).getByRole('alert')).toBeVisible()
  await expect(products(page).getByRole('alert')).toBeVisible()
  await page.route(paths[0]!, route => route.fulfill({ json: { data: { productos: [] } } }))
  await page.route(paths[1]!, route => route.fulfill({ json: { data: { categorias: [] } } }))
  await categories(page).getByRole('button', { name: 'Reintentar categorías' }).click()
  await products(page).getByRole('button', { name: 'Reintentar productos' }).click()
  await expect(categories(page).getByRole('status')).toHaveText('Todavía no hay categorías disponibles.')
  await expect(products(page).getByRole('status')).toHaveText('Todavía no hay productos disponibles.')
  await expect(products(page).getByRole('link', { name: 'Ver catálogo completo' })).toHaveAttribute('href', '/catalogo')
})

test('Home usa la imagen del listado y conserva la tarjeta si falla', async ({ page }) => {
  await page.route('**/api/catalogo?*', async route => {
    const response = await route.fetch()
    const json = await response.json()
    for (const product of json.data.productos) {
      if ([1, 2].includes(product.id)) product.imagen = '/foto-e2e-' + product.id + '.svg'
    }
    await route.fulfill({ response, json })
  })
  await page.route('**/foto-e2e-1.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#145a8d"/></svg>',
  }))
  await page.route('**/foto-e2e-2.svg', route => route.fulfill({ status: 404, body: '' }))
  await page.goto('/')
  const image = products(page).getByRole('img', { name: 'Producto E2E 01' })
  await image.scrollIntoViewIfNeeded()
  await expect(image).toHaveJSProperty('naturalWidth', 24)
  await expect(products(page).getByRole('img', { name: 'Producto E2E 02' })).toHaveCount(0)
  await expect(products(page).getByRole('link', { name: 'Ver producto: Producto E2E 02' })).toBeVisible()
})

test('Home conserva el nombre completo y el acceso a la ficha a 360 px', async ({ page }) => {
  const name = 'Herramienta industrial para taller ' + 'MODELO'.repeat(14)
  await page.setViewportSize({ width: 360, height: 800 })
  await page.route('**/api/catalogo?*', async route => {
    const response = await route.fetch()
    const json = await response.json()
    json.data.productos[0].nombre = name
    await route.fulfill({ response, json })
  }, { times: 1 })
  await page.goto('/')
  const article = products(page).getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await expect(article.getByRole('heading')).toBeVisible()
  const link = article.getByRole('link', { name: 'Ver producto: ' + name })
  await expect(link).toBeVisible()
  expect(await page.locator('html').evaluate(element => element.scrollWidth)).toBe(360)
  await link.click()
  await expect(page).toHaveURL(/\/producto\/1\?returnTo=/)
})

for (const width of [360, 390, 768, 1024, 1280, 1440]) {
  test('Home responsive y navegación con teclado a ' + width + ' px', async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
    await expect(heading).toHaveText('Equipá tu trabajo industrial.')
    await expect(products(page).getByRole('link', { name: /^Ver producto:/ })).toHaveCount(4)
    expect(await page.locator('html').evaluate(element => element.scrollWidth)).toBe(width)

    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Ir al contenido principal' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(header(page).getByRole('link', { name: /Ferrepatagonia Industrial/ })).toBeFocused()
    await page.keyboard.press('Tab')
    const search = header(page).getByRole('searchbox')
    await expect(search).toBeFocused()
    await expect(search).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Tab')
    await expect(header(page).getByRole('button', { name: 'Buscar' })).toBeFocused()

    if (process.env.E2E_HOME_CAPTURES === '1' && [390, 1440].includes(width)) {
      await expect(products(page).getByText('Consultando precios…')).toHaveCount(0)
      await header(page).getByRole('button', { name: 'Buscar' }).blur()
      const screenshot = testInfo.outputPath('home-' + width + '.png')
      await page.screenshot({ path: screenshot, fullPage: true })
      await testInfo.attach('Home ' + width + ' px', { path: screenshot, contentType: 'image/png' })
    }
  })
}
