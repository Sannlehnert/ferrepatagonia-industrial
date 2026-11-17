import { expect, test, type Page } from '@playwright/test'

async function mockApi(page: Page, tipo: 'PARTICULAR' | 'EMPRESA', authenticated = true) {
  const user = {
    id: 1, nombre: 'Cliente de prueba', email: 'cliente@example.test', rol: 'CLIENTE',
    tipo_cliente: tipo, estadoAprobacionEmpresa: tipo === 'EMPRESA' ? 'APROBADA' : null,
    cuentaCorrienteHabilitada: tipo === 'EMPRESA',
  }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/login') {
      authenticated = true
      return route.fulfill({ json: { user } })
    }
    if (path === '/api/auth/me') {
      return authenticated ? route.fulfill({ json: { user } }) : route.fulfill({ status: 401, json: {} })
    }
    if (path === '/api/auth/logout') {
      authenticated = false
      return route.fulfill({ json: {} })
    }
    if (path === '/api/pedidos') return route.fulfill({ json: { data: { items: [] } } })
    if (path === '/api/categorias') return route.fulfill({ json: { data: { categorias: [] } } })
    if (path === '/api/catalogo') return route.fulfill({ json: { data: {
      productos: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0, hasNext: false, hasPrevious: false },
    } } })
    if (path.includes('cuenta-corriente')) return route.fulfill({ json: { data: { estado: 'SIN_CUENTA' } } })
    return route.fulfill({ json: { data: { items: [], totalPages: 0 } } })
  })
}

async function signIn(page: Page) {
  await page.getByLabel('Email', { exact: true }).fill('cliente@example.test')
  await page.getByLabel(/^Contraseña/).fill('clave')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
}

for (const width of [320, 360, 1280]) {
  for (const tipo of ['PARTICULAR', 'EMPRESA'] as const) {
    test(`${tipo} ${width}px: layout, navegación y scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 })
      await mockApi(page, tipo)
      await page.goto('/mi-cuenta')
      await expect(page.getByRole('search', { name: 'Buscar en el catálogo' })).toHaveCount(0)
      await expect(page.locator('.store-header, footer')).toHaveCount(0)
      const toggle = page.getByRole('button', { name: 'Menú de navegación de cuenta' })
      const menu = page.getByRole('navigation', { name: 'Menú de mi cuenta' })
      if (width < 768) await toggle.click()
      await expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
      await expect(menu.getByRole('link', { name: 'Cuenta corriente', exact: true }))
        .toHaveCount(tipo === 'EMPRESA' ? 1 : 0)
      await expect(menu.getByRole('link', { name: 'Pedidos con cuenta corriente' }))
        .toHaveCount(tipo === 'EMPRESA' ? 1 : 0)
      await menu.getByRole('link', { name: 'Pedidos sin comprobante' }).click()
      await expect(page).toHaveURL('/mi-cuenta/pedidos?filtro=sin-comprobante')
      expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
      if (width < 768) await toggle.click()
      await expect(menu.getByRole('link', { name: 'Pedidos sin comprobante' })).toHaveAttribute('aria-current', 'page')
      await expect(menu.getByRole('link', { name: 'Historial de pedidos' })).not.toHaveAttribute('aria-current', 'page')
      if (tipo === 'EMPRESA') {
        await expect(menu.getByRole('link', { name: 'Pedidos con cuenta corriente' })).not.toHaveAttribute('aria-current', 'page')
        await page.locator('main').evaluate(el => { el.style.minHeight = '2500px' })
        await page.evaluate('window.scrollTo(0, 1000)')
        await expect.poll(() => page.evaluate<number>('window.scrollY')).toBeGreaterThan(0)
        await menu.getByRole('link', { name: 'Pedidos con cuenta corriente' }).evaluate(el => el.click())
        await expect(page).toHaveURL('/mi-cuenta/pedidos?filtro=cuenta-corriente')
        await expect.poll(() => page.evaluate<number>('window.scrollY')).toBe(0)
        if (width < 768) await toggle.click()
        await expect(menu.getByRole('link', { name: 'Pedidos con cuenta corriente' })).toHaveAttribute('aria-current', 'page')
        await expect(menu.getByRole('link', { name: 'Pedidos sin comprobante' })).not.toHaveAttribute('aria-current', 'page')
      }
      await page.locator('main').evaluate(el => { el.style.minHeight = '2500px' })
      await page.evaluate('window.scrollTo(0, 1000)')
      await expect.poll(() => page.evaluate<number>('window.scrollY')).toBeGreaterThan(0)
      await menu.getByRole('link', { name: 'Mis datos' }).click()
      await expect(page).toHaveURL('/mi-cuenta/datos')
      await expect.poll(() => page.evaluate<number>('window.scrollY')).toBe(0)
      if (width < 768) await toggle.click()
      await expect(menu.getByRole('link', { name: 'Mis datos' })).toHaveAttribute('aria-current', 'page')
      await expect(menu.locator('[aria-current="page"]')).toHaveCount(1)
      expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    })
  }
}

test('filtro desconocido, vacío o repetido deja activo el historial general', async ({ page }) => {
  await mockApi(page, 'EMPRESA')
  const menu = page.getByRole('navigation', { name: 'Menú de mi cuenta' })
  await page.setViewportSize({ width: 1280, height: 700 })
  for (const query of ['?filtro=desconocido', '?filtro=', '?filtro=desconocido&filtro=x']) {
    await page.goto(`/mi-cuenta/pedidos${query}`)
    await expect(menu.getByRole('link', { name: 'Historial de pedidos' })).toHaveAttribute('aria-current', 'page')
    await expect(menu.locator('[aria-current="page"]')).toHaveCount(1)
  }
  await page.goto('/mi-cuenta/pedidos?filtro=cuenta-corriente')
  await expect(menu.getByRole('link', { name: 'Pedidos con cuenta corriente' })).toHaveAttribute('aria-current', 'page')
  await expect(menu.locator('[aria-current="page"]')).toHaveCount(1)
})

for (const width of [768, 1024, 1280]) {
  test(`sidebar con contenido largo a ${width}px mantiene accesibles Volver a tienda y Cerrar sesión`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 })
    await mockApi(page, 'EMPRESA')
    await page.goto('/mi-cuenta')
    await page.locator('main').evaluate(el => { el.style.minHeight = '4000px' })
    await page.evaluate('window.scrollTo(0, 3000)')
    await expect.poll(() => page.evaluate<number>('window.scrollY')).toBeGreaterThan(0)
    for (const name of ['Volver a tienda', 'Cerrar sesión']) {
      const button = page.locator('aside').getByRole('button', { name })
      await expect(button).toBeInViewport()
    }
  })
}

test('volver a tienda conserva el origen y usa catálogo ante acceso directo', async ({ page }) => {
  await mockApi(page, 'PARTICULAR')
  await page.goto('/catalogo?busqueda=hierro')
  await page.getByRole('link', { name: 'Mi cuenta', exact: true }).click()
  await expect(page).toHaveURL('/mi-cuenta')
  await page.reload()
  await page.getByRole('button', { name: 'Volver a tienda' }).click()
  await expect(page).toHaveURL('/catalogo?busqueda=hierro')
  await page.evaluate('sessionStorage.clear()')
  await page.goto('/mi-cuenta')
  await page.getByRole('button', { name: 'Volver a tienda' }).click()
  await expect(page).toHaveURL('/catalogo')
})

for (const width of [320, 360]) {
  test(`detalle de pedido de empresa sin desborde a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await mockApi(page, 'EMPRESA')
    const order = {
      pedidoId: 1, numero: 'PED-000001', fecha: '2026-11-16T12:00:00.000Z',
      estado: 'EN_PREPARACION', modalidadPago: 'CUENTA_CORRIENTE', moneda: 'USD',
      subtotal: '20.00', descuento: '0.00', total: '20.00', totalUSD: '20.00',
      cantidadLineas: 1, cantidadUnidades: 2,
    }
    await page.route(/\/api\/pedidos(?:\/|$)/, async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/pedidos') {
        return route.fulfill({ json: { data: { items: [order] } } })
      }
      if (path === '/api/pedidos/1') {
        return route.fulfill({ json: { data: { ...order, items: [{
          detalleId: 1, productoId: 1, codigo: 'E2E-01',
          nombre: 'Llave industrial para taller ' + 'EXTRALARGA'.repeat(8),
          cantidad: 2, precioUnitario: '10.00', descuento: '0.00', subtotal: '20.00',
        }] } } })
      }
      if (path === '/api/pedidos/1/comprobantes') {
        return route.fulfill({ json: { data: { items: [], paginaSiguiente: null } } })
      }
      return route.continue()
    })
    await page.goto('/mi-cuenta/pedidos')
    const toggle = page.getByRole('button', { name: 'Ver detalle de PED-000001' })
    await toggle.click()
    await expect(page.getByText('EXTRALARGA'.repeat(8), { exact: false })).toBeVisible()
    const dimensions = await page.locator('html').evaluate(html => ({
      scrollWidth: html.scrollWidth,
      width: html.clientWidth,
    }))
    const overflow = await page.evaluate<string>(
      `JSON.stringify(Array.from(document.querySelectorAll('body *'))
        .filter(element => element.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 8)
        .map(element => ({
          tag: element.tagName,
          className: element.getAttribute('class'),
          right: element.getBoundingClientRect().right,
        })))`,
    )
    expect(dimensions.scrollWidth, overflow).toBeLessThanOrEqual(dimensions.width)
  })
}

test('login respeta contexto público, protegido y destino inválido', async ({ page }) => {
  await mockApi(page, 'PARTICULAR', false)
  await page.goto('/catalogo?busqueda=hierro')
  await page.locator('.store-header').getByRole('link', { name: 'Ingresar', exact: true }).click()
  await signIn(page)
  await expect(page).toHaveURL('/catalogo?busqueda=hierro')
  await page.goto('/mi-cuenta')
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await expect(page).toHaveURL('/login')
  await page.goto('/mi-cuenta/pedidos?filtro=sin-comprobante')
  await signIn(page)
  await expect(page).toHaveURL('/mi-cuenta/pedidos?filtro=sin-comprobante')
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await expect(page).toHaveURL('/login')
  await page.goto('/login?redirect=%2F%2Fexample.com')
  await signIn(page)
  await expect(page).toHaveURL('/mi-cuenta')
})
