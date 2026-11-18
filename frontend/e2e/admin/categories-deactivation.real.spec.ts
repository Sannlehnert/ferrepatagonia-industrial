import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const password = 'E2eLocal-214!'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}

async function createCategory(page: Page, nombre: string, descripcion = 'Descripción de prueba') {
  const response = await page.request.post('/api/admin/categorias', {
    headers: { Origin: new URL(page.url()).origin },
    data: { nombre, descripcion },
  })
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true)
}

function categoryRow(page: Page, nombre: string) {
  return page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: nombre, exact: true }),
  })
}

test.describe('diálogo de desactivación de categorías', () => {
  test.use({ viewport: { width: 360, height: 800 } })

  test('conserva scroll y foco al cancelar y confirmar por teclado', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const prefix = `Categoría desactivación ${suffix}`
    const names = Array.from(
      { length: 10 },
      (_, index) => `${prefix} ${String(index).padStart(2, '0')}`,
    )
    for (const nombre of names) await createCategory(page, nombre)

    await page.goto('/admin/categorias')
    const target = names[8]
    const row = categoryRow(page, target)
    await expect(row).toBeVisible()
    await row.scrollIntoViewIfNeeded()

    const scrollBefore = await page.evaluate('window.scrollY') as number
    expect(scrollBefore).toBeGreaterThan(0)

    const deactivate = row.getByRole('button', { name: `Desactivar ${target}`, exact: true })
    await deactivate.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName('Desactivar categoría')
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused()

    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBeLessThanOrEqual(360)
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Confirmar desactivación' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Confirmar desactivación' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(deactivate).toBeFocused()
    expect(await page.evaluate('window.scrollY')).toBe(scrollBefore)
    await expect(row.getByText('Activa', { exact: true })).toBeVisible()

    await deactivate.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')

    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Categoría desactivada.', { exact: true })).toBeVisible()
    await expect(row.getByText('Inactiva', { exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: `Editar ${target}`, exact: true })).toBeFocused()
    expect(await page.evaluate('window.scrollY')).toBe(scrollBefore)
  })
})

test.describe('errores y envíos duplicados al desactivar categorías', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('bloquea un segundo envío y conserva el diálogo ante un rechazo', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const name = `Categoría rechazo ${suffix}`
    await createCategory(page, name)

    await page.goto('/admin/categorias')
    const row = categoryRow(page, name)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Desactivar ${name}`, exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    let patchRequests = 0
    let releaseRequest: (() => void) | undefined
    const rejectDeactivation = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue()
        return
      }
      patchRequests++
      await new Promise<void>(resolve => { releaseRequest = resolve })
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'La categoría tiene productos asociados.' }),
      })
    }
    await page.route('**/api/admin/categorias/*/desactivar', rejectDeactivation)

    await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click()

    const busyButton = dialog.getByRole('button', { name: 'Desactivando…' })
    await expect(busyButton).toBeDisabled()
    await page.keyboard.press('Enter')
    await expect.poll(() => patchRequests).toBe(1)
    expect(releaseRequest).toBeTruthy()

    releaseRequest!()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('La categoría tiene productos asociados.')
    await expect(row.getByText('Activa', { exact: true })).toBeVisible()
    expect(patchRequests).toBe(1)

    await page.unroute('**/api/admin/categorias/*/desactivar', rejectDeactivation)
    await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(row.getByText('Inactiva', { exact: true })).toBeVisible()
    expect(patchRequests).toBe(1)
  })

  test('ante una respuesta perdida exige recargar y reconcilia el listado', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const name = `Categoría incierta ${suffix}`
    await createCategory(page, name)

    await page.goto('/admin/categorias')
    const row = categoryRow(page, name)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Desactivar ${name}`, exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const scrollBefore = await page.evaluate('window.scrollY') as number

    let patchRequests = 0
    const loseResponse = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue()
        return
      }
      patchRequests++
      const persisted = await page.request.patch(route.request().url(), {
        headers: { Origin: new URL(page.url()).origin },
      })
      expect(persisted.ok(), `${persisted.status()} ${await persisted.text()}`).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Servicio no disponible.' }),
      })
    }
    await page.route('**/api/admin/categorias/*/desactivar', loseResponse)

    await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click()

    await expect(dialog.getByRole('alert')).toContainText('El diálogo quedó bloqueado')
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Confirmar desactivación' })).toBeDisabled()
    expect(patchRequests).toBe(1)

    await page.unroute('**/api/admin/categorias/*/desactivar', loseResponse)
    await dialog.getByRole('button', { name: 'Recargar listado' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Listado actualizado.', { exact: true })).toBeVisible()
    await expect(row.getByText('Inactiva', { exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: `Desactivar ${name}`, exact: true })).toHaveCount(0)
    await expect(row.getByRole('button', { name: `Editar ${name}`, exact: true })).toBeFocused()
    expect(await page.evaluate('window.scrollY')).toBe(scrollBefore)
  })
})
