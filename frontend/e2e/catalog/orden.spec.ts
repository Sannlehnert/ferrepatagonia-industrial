import { test, expect } from '@playwright/test'

test('ordena con la API, persiste entre páginas y filtros, y responde a atrás/adelante', async ({
  page,
}) => {
  await page.goto('/catalogo')

  const names = page.getByRole('heading', { level: 3 })
  const sort = page.getByRole('combobox', { name: 'Ordenar productos' })
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
  await expect(page.getByRole('combobox', { name: 'Ordenar productos' })).toHaveValue('predeterminado')
  await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible()
})
