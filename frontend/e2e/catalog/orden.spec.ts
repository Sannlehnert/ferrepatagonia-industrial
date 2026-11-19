import { test, expect } from '@playwright/test'

test('ordena con la API, persiste entre páginas y filtros, y responde a atrás/adelante', async ({
  page,
}) => {
  await page.goto('/catalogo')

  const names = page.getByRole('heading', { level: 3 })
  const sort = page.getByRole('combobox', { name: 'Ordenar por' })
  const pagination = page.getByRole('navigation', { name: 'Paginación del catálogo' })

  await expect(sort).toBeEnabled()
  await expect(sort).toHaveValue('predeterminado')
  await expect(names).toHaveCount(12)

  const requests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/catalogo')) requests.push(request.url())
  })

  await sort.selectOption('nombre_desc')
  await expect(page).toHaveURL(/\/catalogo\?orden=nombre_desc$/)
  await expect(names.first()).toHaveText('Producto E2E 25')
  expect(requests.at(-1)).toContain('orden=nombre_desc')

  await pagination.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(page).toHaveURL(/orden=nombre_desc/)
  await expect(page).toHaveURL(/page=2/)
  await expect(sort).toHaveValue('nombre_desc')
  await expect(names.first()).toHaveText('Producto E2E 13')

  // Cambiar el orden reinicia la página.
  await sort.selectOption('nombre_asc')
  await expect(page).not.toHaveURL(/page=/)
  await expect(page).toHaveURL(/orden=nombre_asc/)
  await expect(names.first()).toHaveText('Producto E2E 01')

  await page.goBack()
  await expect(sort).toHaveValue('nombre_desc')
  await expect(names.first()).toHaveText('Producto E2E 13')

  await page.goBack()
  await expect(sort).toHaveValue('nombre_desc')
  await expect(names.first()).toHaveText('Producto E2E 25')

  await page.goForward()
  await expect(page).toHaveURL(/page=2/)
  await expect(names.first()).toHaveText('Producto E2E 13')

  // El orden sobrevive a un cambio de búsqueda y volver a predeterminado lo retira de la URL.
  const filters = page.getByRole('form', { name: 'Buscar y filtrar productos' })
  await filters.getByRole('searchbox').fill('Producto E2E 2')
  await filters.getByRole('button', { name: /Aplicar|Buscar/ }).click()
  await expect(page).toHaveURL(/orden=nombre_desc/)
  await expect(page).toHaveURL(/busqueda=/)
  await expect(page).not.toHaveURL(/page=/)
  await expect(sort).toHaveValue('nombre_desc')

  await sort.selectOption('predeterminado')
  await expect(page).not.toHaveURL(/orden=/)
  await expect(page).toHaveURL(/busqueda=/)
})

test('un orden inválido en la URL se normaliza y usa el predeterminado', async ({ page }) => {
  await page.goto('/catalogo?orden=inexistente&page=2')

  await expect(page).not.toHaveURL(/orden=/)
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByRole('combobox', { name: 'Ordenar por' })).toHaveValue('predeterminado')
  await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible()
})

test('ordena por precio público y conserva el criterio al cambiar y quitar la categoría', async ({
  page,
}) => {
  await page.goto('/catalogo')

  const sort = page.getByRole('combobox', { name: 'Ordenar por' })
  const names = page.getByRole('heading', { level: 3 })
  await sort.selectOption('precio_asc')

  await expect(page).toHaveURL(/orden=precio_asc/)
  await expect(page.getByText(
    'El orden usa el precio público del catálogo; tu precio personalizado no modifica la posición.',
    { exact: true },
  )).toBeVisible()
  await expect(names.first()).toHaveText('Producto E2E 24')

  const filters = page.getByRole('form', { name: 'Buscar y filtrar productos' })
  const category = filters.getByRole('combobox', { name: 'Categoría', exact: true })
  await category.selectOption({ label: 'Fijaciones E2E' })
  await filters.getByRole('button', { name: 'Buscar', exact: true }).click()

  await expect(page).toHaveURL(/categoria=2/)
  await expect(page).toHaveURL(/orden=precio_asc/)
  await expect(sort).toHaveValue('precio_asc')
  await expect(names.first()).toHaveText('Producto E2E 24')

  await page.locator('#contenido-principal').getByRole('link', {
    name: 'Catálogo',
    exact: true,
  }).click()
  await expect(page).not.toHaveURL(/categoria=/)
  await expect(page).toHaveURL(/orden=precio_asc/)
  await expect(sort).toHaveValue('precio_asc')
  await expect(names.first()).toHaveText('Producto E2E 24')
})

for (const width of [360, 768, 1280]) {
  test(`controles de orden y paginación accesibles a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/catalogo?categoria=1')

    const sort = page.getByRole('combobox', { name: 'Ordenar por' })
    const breadcrumb = page.locator('#contenido-principal').getByRole('link', { name: 'Catálogo', exact: true })
    const pagination = page.getByRole('navigation', { name: 'Paginación del catálogo' })
    const previous = pagination.getByRole('button', { name: 'Anterior', exact: true })
    const next = pagination.getByRole('button', { name: 'Siguiente', exact: true })
    await expect(page.locator('label[for="catalog-order"]')).toHaveText('Ordenar por')
    await expect(sort.locator('option:checked')).toHaveText('Predeterminado')
    await expect(sort).toHaveCSS('font-size', width < 640 ? '16px' : '14px')
    await expect(next).toBeEnabled()
    expect((await sort.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await breadcrumb.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await previous.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    const contrast = await sort.evaluate(element => {
      const style = element.ownerDocument.defaultView!.getComputedStyle(element)
      const luminance = (color: string) => {
        const channels = color.match(/\d+/g)!.slice(0, 3).map(Number).map(value => {
          const channel = value / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
      }
      const values = [luminance(style.borderTopColor), luminance(style.backgroundColor)].sort((a, b) => b - a)
      return (values[0]! + 0.05) / (values[1]! + 0.05)
    })
    expect(contrast).toBeGreaterThanOrEqual(3)

    await next.focus()
    await expect(next).toBeFocused()
    await expect(next).toHaveCSS('outline-width', '2px')
    await expect(next).toHaveCSS('outline-color', 'rgb(43, 123, 187)')
    await page.keyboard.press('Enter')
    await expect(previous).toBeEnabled()
    await previous.focus()
    await expect(previous).toHaveCSS('outline-width', '2px')
    await expect(previous).toHaveCSS('outline-color', 'rgb(43, 123, 187)')
    await sort.selectOption('precio_asc')
    const help = page.locator('#catalog-order-help')
    await expect(help).toBeVisible()
    expect(Math.abs((await sort.boundingBox())!.x - (await help.boundingBox())!.x)).toBeLessThan(1)
    expect(await sort.evaluate(element =>
      element.ownerDocument.documentElement.scrollWidth <= element.ownerDocument.defaultView!.innerWidth,
    )).toBe(true)
  })
}
