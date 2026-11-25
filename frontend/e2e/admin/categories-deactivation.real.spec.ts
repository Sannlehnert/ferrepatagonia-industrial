import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { deactivateE2ECategories } from '../helpers/e2e-category-cleanup'

const password = 'E2eLocal-214!'
const createdCategoryIds: number[] = []

test.afterAll(async () => {
  await deactivateE2ECategories({ ids: createdCategoryIds })
})

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
  const { id_categoria } = await response.json()
  createdCategoryIds.push(Number(id_categoria))
}

function categoryRow(page: Page, nombre: string) {
  return page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: nombre, exact: true }),
  })
}

async function pressEscapeThrice(page: Page) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

async function deactivationGeometry(dialog: Locator, message?: string) {
  return dialog.evaluate((el: any, expectedMessage: string | undefined) => {
    const doc = el.ownerDocument
    const view = doc.defaultView
    const card = el.querySelector(':scope > div')
    const body = el.querySelector('div.overflow-y-auto')
    const description = el.querySelector('#category-deactivation-description')
    const footer = el.querySelector('footer')
    const alertNode = expectedMessage
      ? [...el.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes(expectedMessage))
      : null
    const rect = (node: any) => {
      const value = node.getBoundingClientRect()
      return {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      }
    }
    const buttons = [...footer.querySelectorAll('button')].map((button: any) => {
      const box = rect(button)
      const target = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return {
        label: button.textContent?.trim() ?? '',
        rect: box,
        clickable: target === button || button.contains(target),
      }
    })

    return {
      viewportWidth: view.innerWidth,
      viewportHeight: view.innerHeight,
      docScroll: doc.documentElement.scrollWidth,
      card: rect(card),
      cardClient: card.clientWidth,
      cardScroll: card.scrollWidth,
      body: rect(body),
      description: rect(description),
      descriptionClient: description.clientWidth,
      descriptionScroll: description.scrollWidth,
      footer: rect(footer),
      alert: alertNode ? rect(alertNode) : null,
      alertClient: alertNode?.clientWidth ?? null,
      alertScroll: alertNode?.scrollWidth ?? null,
      alertInsideBody: alertNode ? body.contains(alertNode) : null,
      buttons,
    }
  }, message)
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
    await expect(dialog.locator('#category-deactivation-description')).toContainText(
      'La categoría dejará de aparecer en el catálogo público, sin eliminar sus productos asociados.',
    )
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

  test('desactiva, autocierra aviso a los 4s, oculta de /catalogo y reactiva en 1 clic conservando scroll y foco', async ({ page }) => {
    test.setTimeout(90_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const prefix = `Categoría ciclo ${suffix}`
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

    await row.getByRole('button', { name: `Desactivar ${target}`, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click()
    await expect(dialog).toHaveCount(0)

    const deactivatedToast = page.getByRole('status').filter({ hasText: 'Categoría desactivada.' })
    await expect(deactivatedToast).toBeVisible()
    await expect(row.getByText('Inactiva', { exact: true })).toBeVisible()
    await expect(deactivatedToast).toBeHidden({ timeout: 6500 })

    // Verifica que desaparece del selector público de /catalogo.
    await page.goto('/catalogo')
    const catalogCategory = page.getByRole('combobox', { name: 'Categoría', exact: true })
    await expect(catalogCategory).toBeEnabled()
    expect(await catalogCategory.locator('option').allTextContents()).not.toContain(target)

    // Vuelve a /admin/categorias y reactiva en 1 clic.
    await page.goto('/admin/categorias')
    const rowBack = categoryRow(page, target)
    await expect(rowBack).toBeVisible()
    await rowBack.scrollIntoViewIfNeeded()
    const scrollBeforeActivate = await page.evaluate('window.scrollY') as number
    expect(scrollBeforeActivate).toBeGreaterThan(0)

    const activateButton = rowBack.getByRole('button', { name: `Activar ${target}`, exact: true })
    await expect(activateButton).toBeVisible()
    await activateButton.click()

    const activatedToast = page.getByRole('status').filter({ hasText: 'Categoría activada.' })
    await expect(activatedToast).toBeVisible()
    await expect(rowBack.getByText('Activa', { exact: true })).toBeVisible()
    const deactivateButton = rowBack.getByRole('button', { name: `Desactivar ${target}`, exact: true })
    await expect(deactivateButton).toBeVisible()
    await expect(deactivateButton).toBeFocused()
    const scrollAfterActivate = await page.evaluate('window.scrollY') as number
    expect(Math.abs(scrollAfterActivate - scrollBeforeActivate)).toBeLessThanOrEqual(1)
    await expect(activatedToast).toBeHidden({ timeout: 6500 })

    // Reaparece en el catálogo público.
    await page.goto('/catalogo')
    const catalogCategoryAfter = page.getByRole('combobox', { name: 'Categoría', exact: true })
    await expect(catalogCategoryAfter).toBeEnabled()
    expect(await catalogCategoryAfter.locator('option').allTextContents()).toContain(target)
  })

  test('el cierre nativo sincroniza el estado Vue y restaura foco y scroll', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const name = `Categoría cierre nativo ${suffix}`
    await createCategory(page, name)

    await page.goto('/admin/categorias')
    const row = categoryRow(page, name)
    await expect(row).toBeVisible()
    await row.scrollIntoViewIfNeeded()
    const scrollBefore = await page.evaluate('window.scrollY') as number

    const deactivate = row.getByRole('button', { name: `Desactivar ${name}`, exact: true })
    await deactivate.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await page.evaluate(() => {
      const native = (globalThis as any).document.querySelector('dialog')
      native?.close()
    })

    await expect(dialog).toHaveCount(0)
    await expect(deactivate).toBeFocused()
    await expect(row.getByText('Activa', { exact: true })).toBeVisible()
    expect(await page.evaluate('window.scrollY')).toBe(scrollBefore)
    expect(await page.evaluate(() => (globalThis as any).document.body.style.overflow)).toBe('')
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
    await pressEscapeThrice(page)
    await expect(dialog).toBeVisible()
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

    const reloadButton = dialog.getByRole('button', { name: 'Recargar listado' })
    await page.keyboard.press('Tab')
    await expect(reloadButton).toBeFocused()
    const reloadOutline = await reloadButton.evaluate((el: any) => {
      const style = el.ownerDocument.defaultView.getComputedStyle(el)
      return {
        width: style.outlineWidth,
        style: style.outlineStyle,
        color: style.outlineColor,
        offset: style.outlineOffset,
      }
    })
    expect(reloadOutline).toEqual({ width: '2px', style: 'solid', color: 'rgb(20, 90, 141)', offset: '2px' })

    // Un cierre nativo durante el estado incierto debe reabrir el diálogo y mantener el bloqueo.
    await page.evaluate(() => {
      const native = (globalThis as any).document.querySelector('dialog')
      native?.close()
    })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('El diálogo quedó bloqueado')
    await pressEscapeThrice(page)
    await expect(dialog).toBeVisible()

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

test.describe('geometría y cadenas largas del diálogo de desactivación', () => {
  test.use({ viewport: { width: 360, height: 800 } })

  test('descripción y error largo no desbordan a seis viewports y el diálogo se recupera', async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)

    const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
    const longName = `${'N'.repeat(142)}${suffix}`
    await createCategory(page, longName)

    await page.goto('/admin/categorias')
    const row = categoryRow(page, longName)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Desactivar ${longName}`, exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#category-deactivation-description')).toContainText(
      'La categoría dejará de aparecer en el catálogo público, sin eliminar sus productos asociados.',
    )

    const viewports = [
      { width: 320, height: 380 },
      { width: 360, height: 380 },
      { width: 360, height: 480 },
      { width: 360, height: 640 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ]

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect(dialog).toBeVisible()
      await dialog.evaluate((el: any) => {
        const body = el.querySelector('div.overflow-y-auto')
        if (body) body.scrollTop = 0
      })

      const metrics = await deactivationGeometry(dialog)
      const label = `${viewport.width}x${viewport.height}`

      expect(metrics.docScroll, `documento desborda a ${label}`).toBeLessThanOrEqual(metrics.viewportWidth)
      expect(metrics.cardScroll, `tarjeta desborda a ${label}`).toBeLessThanOrEqual(metrics.cardClient + 1)
      expect(metrics.card.left, `tarjeta izquierda a ${label}`).toBeGreaterThanOrEqual(-1)
      expect(metrics.card.right, `tarjeta derecha a ${label}`).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      expect(metrics.card.top, `tarjeta arriba a ${label}`).toBeGreaterThanOrEqual(-1)
      expect(metrics.card.bottom, `tarjeta abajo a ${label}`).toBeLessThanOrEqual(metrics.viewportHeight + 1)
      expect(metrics.descriptionScroll, `descripción desborda a ${label}`).toBeLessThanOrEqual(metrics.descriptionClient + 1)
      expect(metrics.description.left, `descripción izquierda a ${label}`).toBeGreaterThanOrEqual(metrics.card.left - 1)
      expect(metrics.description.right, `descripción derecha a ${label}`).toBeLessThanOrEqual(metrics.card.right + 1)
      expect(metrics.footer.bottom, `footer visible a ${label}`).toBeLessThanOrEqual(metrics.viewportHeight + 1)
      expect(metrics.buttons.length, `acciones del footer a ${label}`).toBe(2)

      for (const button of metrics.buttons) {
        expect(button.rect.top, `${button.label} arriba a ${label}`).toBeGreaterThanOrEqual(metrics.footer.top - 1)
        expect(button.rect.bottom, `${button.label} abajo a ${label}`).toBeLessThanOrEqual(metrics.footer.bottom + 1)
        expect(button.rect.bottom, `${button.label} visible a ${label}`).toBeLessThanOrEqual(metrics.viewportHeight + 1)
        expect(button.clickable, `${button.label} accionable a ${label}`).toBe(true)
      }
    }

    const longMessage = `Error de servidor ${'X'.repeat(160)}`
    const rejectDeactivation = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: longMessage }),
      })
    }
    await page.route('**/api/admin/categorias/*/desactivar', rejectDeactivation)

    await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click()
    const alert = dialog.getByRole('alert').filter({ hasText: longMessage })
    await expect(alert).toBeVisible()

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect(dialog).toBeVisible()
      await dialog.evaluate((el: any) => {
        const body = el.querySelector('div.overflow-y-auto')
        if (body) body.scrollTop = 0
      })

      const metrics = await deactivationGeometry(dialog, longMessage)
      const label = `${viewport.width}x${viewport.height} con error`

      expect(metrics.docScroll, `documento desborda a ${label}`).toBeLessThanOrEqual(metrics.viewportWidth)
      expect(metrics.cardScroll, `tarjeta desborda a ${label}`).toBeLessThanOrEqual(metrics.cardClient + 1)
      expect(metrics.alert, `alerta presente a ${label}`).not.toBeNull()
      expect(metrics.alertInsideBody, `alerta dentro del scroll a ${label}`).toBe(true)
      expect(metrics.alertScroll, `alerta desborda a ${label}`).toBeLessThanOrEqual((metrics.alertClient ?? 0) + 1)
      expect(metrics.alert!.left, `alerta izquierda a ${label}`).toBeGreaterThanOrEqual(metrics.card.left - 1)
      expect(metrics.alert!.right, `alerta derecha a ${label}`).toBeLessThanOrEqual(metrics.card.right + 1)
      expect(metrics.footer.bottom, `footer visible a ${label}`).toBeLessThanOrEqual(metrics.viewportHeight + 1)

      for (const button of metrics.buttons) {
        expect(button.rect.bottom, `${button.label} visible a ${label}`).toBeLessThanOrEqual(metrics.viewportHeight + 1)
        expect(button.clickable, `${button.label} accionable a ${label}`).toBe(true)
      }
    }

    await page.unroute('**/api/admin/categorias/*/desactivar', rejectDeactivation)
    await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Categoría desactivada.', { exact: true })).toBeVisible()
    await expect(row.getByText('Inactiva', { exact: true })).toBeVisible()
  })
})
