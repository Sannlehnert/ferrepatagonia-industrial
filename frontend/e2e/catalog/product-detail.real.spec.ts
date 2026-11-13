import { expect, test } from '@playwright/test'

test('catálogo abre el detalle y conserva búsqueda, categoría y página al volver', async ({ page }) => {
  await page.goto('/catalogo?categoria=1&busqueda=Producto%20E2E&page=2')

  const productLink = page.getByRole('link', { name: 'Producto E2E 13', exact: true })
  await expect(productLink).toBeVisible()
  await productLink.click()

  await expect(page).toHaveURL(/\/producto\/13\?returnTo=/)
  await expect(page.getByRole('heading', { name: 'Producto E2E 13', exact: true })).toBeVisible()

  const returnLink = page.getByRole('link', { name: 'Volver al catálogo' }).first()
  await expect(returnLink).toHaveAttribute(
    'href',
    '/catalogo?categoria=1&busqueda=Producto%20E2E&page=2',
  )
  await returnLink.click()

  await expect(page).toHaveURL('/catalogo?categoria=1&busqueda=Producto%20E2E&page=2')
  const filters = page.getByRole('form', { name: 'Buscar y filtrar productos' })
  await expect(filters.getByRole('searchbox', { name: 'Nombre o código' })).toHaveValue('Producto E2E')
  await expect(filters.getByRole('combobox', { name: 'Categoría', exact: true })).toHaveValue('1')
  await expect(page.getByRole('navigation', { name: 'Paginación del catálogo' }))
    .toContainText('Página 2 de 2')
})

test('detalle público y recorrido Home → categoría → producto → carrito usan datos reales', async ({ page }) => {
  const apiDetail = await page.request.get('/api/catalogo/24')
  expect(apiDetail.status()).toBe(200)
  const { data } = await apiDetail.json()
  expect(data.producto).toMatchObject({
    id: 24,
    nombre: 'Producto E2E 24',
    codigo: 'E2E-24',
    descripcion: 'Descripción de prueba',
    precio: null,
  })
  expect(data.producto.stock).toBeGreaterThan(0)
  expect(data.producto.disponible).toBe(true)
  expect(data.producto.categoria.nombre).toEqual(expect.any(String))

  await page.goto('/producto/24?returnTo=%2Fcatalogo%3Fcategoria%3D1%26busqueda%3DE2E-24%26page%3D2')
  await expect(page.getByRole('heading', { name: 'Producto E2E 24', exact: true })).toBeVisible()
  await expect(page.getByText(`Categoría: ${data.producto.categoria.nombre}`)).toBeVisible()
  await expect(page.getByText('Descripción de prueba', { exact: true })).toBeVisible()
  await expect(page.getByText(`${data.producto.stock} unidades disponibles`)).toBeVisible()
  await expect(page.getByText('Sin imagen disponible')).toBeVisible()
  await expect(page.getByText('Iniciá sesión para agregar productos.')).toBeVisible()
  const returnLink = page.getByRole('link', { name: 'Volver al catálogo' }).first()
  await expect(returnLink).toHaveAttribute('href', '/catalogo?categoria=1&busqueda=E2E-24&page=2')
  await expect(page.getByRole('button', { name: 'Agregar', exact: true })).toBeDisabled()

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('cliente-nuevo@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/mi-cuenta\/datos$/)
  await page.goto('/')
  await page.getByRole('region', { name: 'Categorías del catálogo' })
    .getByRole('link', { name: 'Fijaciones E2E' }).click()
  await expect(page).toHaveURL('/catalogo?categoria=2')
  const productLink = page.getByRole('link', { name: data.producto.nombre, exact: true })
  await productLink.click()
  const detailURL = /\/producto\/24\?returnTo=/
  await expect(page).toHaveURL(detailURL)
  await page.goBack()
  await expect(page).toHaveURL('/catalogo?categoria=2')
  await expect(productLink).toBeVisible()

  const detailPrice = page.waitForResponse(response => {
    const request = response.request()
    if (new URL(response.url()).pathname !== '/api/precios/mios' || request.method() !== 'POST') return false
    const { productos } = request.postDataJSON()
    return productos.length === 1 && productos[0].productoId === data.producto.id
  })
  await page.goForward()
  await expect(page).toHaveURL(detailURL)
  const quote = await detailPrice
  expect(quote.ok()).toBe(true)
  const [line] = (await quote.json()).data.productos
  expect(line).toMatchObject({ productoId: data.producto.id, precioComprable: true, precioUnitarioUSD: '124.00' })
  await expect(page.getByText(`USD ${line.precioUnitarioUSD}`, { exact: true })).toBeVisible()
  const add = page.getByRole('button', { name: 'Agregar', exact: true })
  await expect(add).toBeEnabled()
  const addRequest = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/carrito/items' && response.request().method() === 'POST')
  await add.click()
  expect((await addRequest).status()).toBe(204)
  const drawer = page.getByRole('dialog', { name: 'Tu carrito' })
  await expect(drawer.getByRole('list', { name: 'Productos del carrito' })).toContainText('Producto E2E 24')
  await drawer.getByRole('link', { name: 'Ver carrito completo' }).click()
  await expect(page).toHaveURL('/carrito')
  await expect(page.getByRole('region', { name: 'Resumen del carrito' }))
    .toContainText(`USD ${line.precioUnitarioUSD}`)
  const cart = await page.request.get('/api/carrito')
  expect(cart.ok()).toBe(true)
  expect((await cart.json()).items).toEqual([expect.objectContaining({
    id_producto: data.producto.id,
    cantidad: 1,
    precio: expect.objectContaining({ precioUnitarioUSD: line.precioUnitarioUSD }),
  })])
  await page.getByRole('button', { name: 'Eliminar Producto E2E 24 del carrito' }).click()
  await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()
})

test('detalle no disponible muestra vacío controlado y oculta imágenes rotas', async ({ page }) => {
  await page.goto('/producto/1')
  await expect(page.getByRole('heading', { name: 'Producto E2E 01', exact: true })).toBeVisible()
  await expect(page.getByText('Sin stock', { exact: true })).toBeVisible()
  await expect(page.getByText('Sin imagen disponible')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Agregar', exact: true })).toBeDisabled()

  await page.goto('/producto/99999')
  await expect(page.getByText('No encontramos ese producto en el catálogo.')).toBeVisible()
})
