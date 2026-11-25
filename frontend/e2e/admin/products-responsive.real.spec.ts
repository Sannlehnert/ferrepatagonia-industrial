import { expect, test, type Locator, type Page } from '@playwright/test'

const widths = [320, 360, 390, 768, 1024, 1280] as const

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}

async function expectInViewport(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box, `El control ${await locator.getAttribute('aria-label') ?? ''} debe tener geometría`).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!box || !viewport) return
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
}

test('el catálogo ADMIN presenta fichas accesibles en móvil y conserva la tabla en escritorio', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await login(page)
  await page.goto('/admin/productos?busqueda=E2E-25')

  const heading = page.getByRole('heading', { name: 'Catálogo de Productos', exact: true })
  const actions = page.getByRole('group', { name: 'Acciones del catálogo' })
  const create = actions.getByRole('button', { name: '+ Nuevo Producto', exact: true })
  const importButton = actions.getByRole('link', { name: 'Importar productos', exact: true })
  const exportButton = actions.getByRole('button', { name: 'Exportar a Excel', exact: true })
  const table = page.getByRole('table', { name: 'Productos del catálogo' })
  const region = page.getByRole('region', { name: 'Tabla desplazable de productos' })
  const row = table.locator('tbody tr').first()
  const verify = page.getByRole('button', {
    name: 'Verificar precio de Producto E2E 25',
    exact: true,
  })
  const edit = page.getByRole('button', { name: 'Editar Producto E2E 25', exact: true })
  const status = page.getByRole('button', { name: 'Desactivar Producto E2E 25', exact: true })

  await expect(table.getByRole('rowheader', { name: 'Producto E2E 25', exact: true })).toBeVisible()
  await expect(create).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Nuevo Producto', exact: false })).toHaveCount(1)

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await expect(heading).toBeVisible()
    await expect(actions).toBeVisible()
    await expectInViewport(page, create)
    await expectInViewport(page, importButton)
    await expectInViewport(page, exportButton)

    // La acción primaria está en la cabecera, antes del listado y no al final.
    const createBox = await create.boundingBox()
    const tableBox = await table.boundingBox()
    expect(createBox!.y).toBeLessThan(tableBox!.y)

    // El listado identifica todos los datos prioritarios en cualquier ancho.
    await expect(row).toContainText('Producto E2E 25')
    await expect(row).toContainText('E2E-25')
    await expect(row).toContainText('Fijaciones E2E')
    await expect(row).toContainText('30')
    await expect(row).toContainText('125.00')
    await expect(row).toContainText('Activo')

    // Sin desbordamiento global. En móvil/tablet la ficha no exige scroll
    // horizontal; en escritorio el scroll queda contenido en la región.
    expect(await page.locator('html').evaluate(element => element.ownerDocument.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width)
    expect(await page.locator('html').evaluate(element => element.ownerDocument.body.scrollWidth))
      .toBeLessThanOrEqual(width)
    if (width < 1024) {
      const geometry = await region.evaluate(element => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
        overflowX: element.ownerDocument.defaultView!.getComputedStyle(element).overflowX,
      }))
      expect(geometry.overflowX).toBe('auto')
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1)
      const note = page.locator('#admin-products-scroll > span')
      await expect(note.nth(0)).toBeVisible()
      await expect(note.nth(0)).toContainText('ficha')
      await expect(note.nth(1)).toBeHidden()
    } else {
      const note = page.locator('#admin-products-scroll > span')
      await expect(note.nth(0)).toBeHidden()
      await expect(note.nth(1)).toBeVisible()
      await expect(note.nth(1)).toContainText('desplazá la tabla')
    }

    // Las tres acciones administrativas siguen accesibles en cada ficha.
    await expectInViewport(page, verify)
    await expectInViewport(page, edit)
    await expectInViewport(page, status)
  }

  // Las etiquetas de campo de las fichas móviles se exponen sin depender del
  // encabezado visual oculto.
  await page.setViewportSize({ width: 390, height: 900 })
  const labels = await row.locator('td[data-label]:not([data-label=""])').evaluateAll(cells =>
    cells.map(cell => {
      const label = cell.getAttribute('data-label')
      return Boolean(label && cell.ownerDocument.defaultView!.getComputedStyle(cell, '::before')
        .content.includes(label))
    }),
  )
  expect(labels).toEqual([true, true, true, true, true])

  await page.screenshot({
    path: '../docs/354/evidence/admin-products-responsive-390.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 320, height: 900 })
  await page.screenshot({
    path: '../docs/354/evidence/admin-products-responsive-320.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 768, height: 900 })
  await page.screenshot({
    path: '../docs/354/evidence/admin-products-responsive-768.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 900 })

  // Edición accesible con teclado desde la ficha.
  await edit.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: /^Editar Producto #/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(edit).toBeFocused()

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByRole('columnheader')).toHaveCount(7)
  await page.screenshot({
    path: '../docs/354/evidence/admin-products-responsive-1280.png',
    fullPage: true,
  })
})
