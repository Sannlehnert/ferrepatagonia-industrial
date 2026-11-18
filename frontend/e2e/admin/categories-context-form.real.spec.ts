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

test.describe('formulario contextual de categorías', () => {
  test.use({ viewport: { width: 360, height: 800 } })

  test('crea y edita en modal conservando foco, lista y posición de scroll', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const prefix = `Categoría contextual ${suffix}`
    const names = Array.from(
      { length: 10 },
      (_, index) => `${prefix} ${String(index).padStart(2, '0')}`,
    )
    for (const nombre of names) await createCategory(page, nombre)

    await page.goto('/admin/categorias')
    const target = names[7]
    const row = categoryRow(page, target)
    await expect(row).toBeVisible()
    await row.scrollIntoViewIfNeeded()

    const scrollBefore = await page.evaluate('window.scrollY') as number
    expect(scrollBefore).toBeGreaterThan(0)

    await row.getByRole('button', { name: `Editar ${target}`, exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName('Editar categoría')

    const nameInput = dialog.getByLabel('Nombre', { exact: true })
    const descriptionInput = dialog.getByLabel('Descripción (opcional)')
    await expect(nameInput).toBeFocused()
    await expect(nameInput).toHaveValue(target)
    await expect(descriptionInput).toHaveValue('Descripción de prueba')

    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBeLessThanOrEqual(360)
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

    const save = dialog.getByRole('button', { name: 'Guardar categoría' })
    await save.focus()
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((node: any) => {
      const active = node.ownerDocument.activeElement
      return Boolean(active && node.contains(active))
    })).toBe(true)

    const edited = `${target} editada`
    await nameInput.fill(edited)
    await descriptionInput.fill('Descripción actualizada')
    await save.click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Categoría actualizada.', { exact: true })).toBeVisible()

    const editedRow = categoryRow(page, edited)
    await expect(editedRow).toBeVisible()
    await expect(editedRow.getByText('Descripción actualizada', { exact: true })).toBeVisible()
    await expect(editedRow.getByRole('button', { name: `Editar ${edited}`, exact: true })).toBeFocused()

    const scrollAfterSave = await page.evaluate('window.scrollY') as number
    expect(Math.abs(scrollAfterSave - scrollBefore)).toBeLessThanOrEqual(1)

    await editedRow.getByRole('button', { name: `Editar ${edited}`, exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Nombre', { exact: true }).fill(`${edited} sin guardar`)

    page.once('dialog', async prompt => {
      expect(prompt.message()).toContain('cambios sin guardar')
      await prompt.dismiss()
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    page.once('dialog', async prompt => {
      await prompt.accept()
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await expect(page.getByRole('heading', { name: edited, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: `${edited} sin guardar`, exact: true })).toHaveCount(0)
    const scrollAfterCancel = await page.evaluate('window.scrollY') as number
    expect(Math.abs(scrollAfterCancel - scrollBefore)).toBeLessThanOrEqual(1)
  })
})

test.describe('errores y envíos duplicados del formulario de categorías', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('conserva el borrador ante rechazo y bloquea un segundo envío en vuelo', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const name = `Categoría error ${suffix}`
    const edited = `${name} editada`
    await createCategory(page, name)

    await page.goto('/admin/categorias')
    const row = categoryRow(page, name)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Editar ${name}`, exact: true }).click()

    const dialog = page.getByRole('dialog')
    const nameInput = dialog.getByLabel('Nombre', { exact: true })
    await expect(dialog).toBeVisible()

    let putRequests = 0
    const rejectUpdate = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue()
        return
      }
      putRequests++
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'El nombre ya existe.' }),
      })
    }
    await page.route('**/api/admin/categorias/*', rejectUpdate)

    await nameInput.fill(edited)
    await dialog.getByRole('button', { name: 'Guardar categoría' }).click()

    await expect(dialog.getByRole('alert')).toContainText('El nombre ya existe.')
    await expect(dialog).toBeVisible()
    await expect(nameInput).toHaveValue(edited)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: edited, exact: true })).toHaveCount(0)
    expect(putRequests).toBe(1)

    await page.unroute('**/api/admin/categorias/*', rejectUpdate)
    await dialog.getByRole('button', { name: 'Guardar categoría' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: edited, exact: true })).toBeVisible()

    let postRequests = 0
    let releaseRequest: (() => void) | undefined
    const delayedCreate = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      postRequests++
      await new Promise<void>(resolve => { releaseRequest = resolve })
      await route.continue()
    }
    await page.route('**/api/admin/categorias', delayedCreate)

    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    const createDialog = page.getByRole('dialog')
    const createName = createDialog.getByLabel('Nombre', { exact: true })
    await createName.fill(`Categoría doble ${suffix}`)
    const createSave = createDialog.getByRole('button', { name: 'Guardar categoría' })
    await createSave.click()

    const saving = createDialog.getByRole('button', { name: 'Guardando…' })
    await expect(saving).toBeDisabled()
    await createName.press('Enter')
    await expect.poll(() => postRequests).toBe(1)
    expect(releaseRequest).toBeTruthy()

    releaseRequest!()
    await expect(createDialog).toHaveCount(0)
    await expect(page.getByText('Categoría creada.', { exact: true })).toBeVisible()
    expect(postRequests).toBe(1)

    await page.unroute('**/api/admin/categorias', delayedCreate)
  })
})
