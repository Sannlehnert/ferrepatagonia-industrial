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

async function pressEscapeThrice(page: Page) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

async function bodyScrollStyle(page: Page) {
  return page.evaluate(() => {
    const body = (globalThis as any).document.body
    return { overflow: body.style.overflow, paddingRight: body.style.paddingRight }
  })
}

test.describe('robustez del cierre y geometría del formulario contextual', () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test('Escape repetido conserva el borrador, el scroll y restaura el foco del listado', async ({ page }) => {
    test.setTimeout(90_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const prefix = `Categoría escape ${suffix}`
    const names = Array.from({ length: 10 }, (_, index) => `${prefix} ${String(index).padStart(2, '0')}`)
    for (const nombre of names) await createCategory(page, nombre)

    await page.goto('/admin/categorias')
    const target = names[7]
    const row = categoryRow(page, target)
    await expect(row).toBeVisible()
    await row.scrollIntoViewIfNeeded()
    const scrollBefore = await page.evaluate('window.scrollY') as number
    expect(scrollBefore).toBeGreaterThan(0)

    const edit = row.getByRole('button', { name: `Editar ${target}`, exact: true })
    await edit.click()
    const dialog = page.getByRole('dialog')
    const nameInput = dialog.getByLabel('Nombre', { exact: true })
    const draft = `${target} sin guardar`
    await nameInput.fill(draft)
    await nameInput.focus()

    let acceptPrompt = false
    const prompts: string[] = []
    page.on('dialog', async prompt => {
      prompts.push(prompt.message())
      if (acceptPrompt) await prompt.accept()
      else await prompt.dismiss()
    })

    await pressEscapeThrice(page)

    await expect(dialog).toBeVisible()
    await expect(nameInput).toHaveValue(draft)
    expect(prompts.length).toBeGreaterThanOrEqual(1)
    expect(prompts.every(message => message.includes('cambios sin guardar'))).toBe(true)

    acceptPrompt = true
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await expect(page.getByRole('heading', { name: target, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Editar ${target}`, exact: true })).toBeFocused()
    expect(await page.evaluate('window.scrollY') as number).toBe(scrollBefore)
    expect(await bodyScrollStyle(page)).toEqual({ overflow: '', paddingRight: '' })
  })

  test('Escape repetido no cierra durante un guardado en curso ni pierde el borrador', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const name = `Categoría ocupada ${suffix}`
    await createCategory(page, name)
    await page.goto('/admin/categorias')
    const row = categoryRow(page, name)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Editar ${name}`, exact: true }).click()

    const dialog = page.getByRole('dialog')
    const nameInput = dialog.getByLabel('Nombre', { exact: true })
    await expect(nameInput).toBeFocused()

    let releaseRequest: (() => void) | undefined
    let putRequests = 0
    await page.route('**/api/admin/categorias/*', async route => {
      if (route.request().method() !== 'PUT') {
        await route.continue()
        return
      }
      putRequests++
      await new Promise<void>(resolve => { releaseRequest = resolve })
      await route.continue()
    })

    const edited = `${name} editada`
    await nameInput.fill(edited)
    await dialog.getByRole('button', { name: 'Guardar categoría' }).click()
    const saving = dialog.getByRole('button', { name: 'Guardando…' })
    await expect(saving).toBeDisabled()

    // «Guardando…» se pinta antes de que el PUT llegue a page.route: sin esta
    // sincronización, Escape puede ejecutarse antes de que exista la solicitud.
    await expect.poll(
      () => putRequests,
      { message: 'PUT de la categoría interceptado' },
    ).toBe(1)

    try {
      await pressEscapeThrice(page)

      await expect(dialog).toBeVisible()
      await expect(nameInput).toHaveValue(edited)
      expect(putRequests).toBe(1)
    } finally {
      // Librar la solicitud retenida aunque falle una aserción.
      releaseRequest!()
    }

    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: edited, exact: true })).toBeVisible()
    expect(putRequests).toBe(1)
    expect(await page.evaluate('document.body.style.overflow')).toBe('')
  })

  test('un resultado incierto bloquea Escape y la recarga mantiene la alerta visible en móvil', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const name = `Categoría incierta ${suffix}`
    await createCategory(page, name)
    await page.goto('/admin/categorias')
    const row = categoryRow(page, name)
    await expect(row).toBeVisible()
    const edit = row.getByRole('button', { name: `Editar ${name}`, exact: true })
    await edit.click()

    const dialog = page.getByRole('dialog')
    const nameInput = dialog.getByLabel('Nombre', { exact: true })
    const uncertainMessage = /No se pudo confirmar el resultado/
    await page.route('**/api/admin/categorias/*', async route => {
      if (route.request().method() !== 'PUT') {
        await route.continue()
        return
      }
      await route.abort('failed')
    })

    await nameInput.fill(`${name} en duda`)
    await dialog.getByRole('button', { name: 'Guardar categoría' }).click()
    const alert = dialog.getByRole('alert').filter({ hasText: uncertainMessage })
    await expect(alert).toBeVisible()

    await pressEscapeThrice(page)
    await expect(dialog).toBeVisible()
    await expect(alert).toBeVisible()
    await expect(nameInput).toHaveValue(`${name} en duda`)

    // La recarga bloqueante tampoco permite cerrar y mantiene la alerta a la vista.
    let releaseReload: (() => void) | undefined
    let reloadRequests = 0
    await page.route('**/api/admin/categorias', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      reloadRequests++
      await new Promise<void>(resolve => { releaseReload = resolve })
      await route.continue()
    })

    await dialog.getByRole('button', { name: 'Recargar listado' }).click()
    await expect(dialog.getByRole('button', { name: 'Recargando…' })).toBeDisabled()
    await pressEscapeThrice(page)

    await expect(dialog).toBeVisible()
    await expect(alert).toBeVisible()
    await page.setViewportSize({ width: 360, height: 480 })
    await page.evaluate(() => {
      const body = (globalThis as any).document.querySelector('dialog form .overflow-y-auto')
      body.scrollTop = body.scrollHeight
    })
    await expect(alert).toBeVisible()
    const visibility = await alert.evaluate((el: any) => {
      const rect = el.getBoundingClientRect()
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: el.ownerDocument.defaultView.innerHeight,
        scrollHeight: el.closest('form')!.querySelector('.overflow-y-auto').scrollTop,
      }
    })
    expect(visibility.top).toBeGreaterThanOrEqual(0)
    expect(visibility.bottom).toBeLessThanOrEqual(visibility.viewportHeight)
    expect(reloadRequests).toBe(1)

    expect(releaseReload).toBeTruthy()
    releaseReload!()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    // Tras recargar el listado, el foco vuelve al origen o al alta si el nodo se recreó.
    await expect.poll(() => page.evaluate(() => {
      const active = (globalThis as any).document.activeElement
      return active?.getAttribute('aria-label') || active?.textContent?.trim() || ''
    })).toMatch(/Editar Categoría incierta|Nueva categoría/)
    expect(await bodyScrollStyle(page)).toEqual({ overflow: '', paddingRight: '' })
  })

  test('errores largos, alertas y controles no desbordan en móvil ni escritorio', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    const suffix = randomUUID().slice(0, 8)
    const name = `Categoría geometría ${suffix}`
    await createCategory(page, name)
    await page.goto('/admin/categorias')
    const row = categoryRow(page, name)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Editar ${name}`, exact: true }).click()

    const dialog = page.getByRole('dialog')
    const nameInput = dialog.getByLabel('Nombre', { exact: true })
    const description = dialog.getByLabel('Descripción (opcional)')
    const longMessage = 'X'.repeat(160)

    await page.route('**/api/admin/categorias/*', async route => {
      if (route.request().method() !== 'PUT') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: longMessage }),
      })
    })

    await nameInput.fill(`${name} con error largo`)
    await dialog.getByRole('button', { name: 'Guardar categoría' }).click()
    const alert = dialog.getByRole('alert').filter({ hasText: longMessage })
    await expect(alert).toBeVisible()

    for (const width of [320, 360, 768, 1280]) {
      await page.setViewportSize({ width, height: 700 })
      await expect(dialog).toBeVisible()
      await page.evaluate(() => {
        const body = (globalThis as any).document.querySelector('dialog form .overflow-y-auto')
        body.scrollTop = body.scrollHeight
      })
      await expect(alert).toBeVisible()
      await expect(nameInput).toHaveValue(`${name} con error largo`)

      const metrics = await dialog.evaluate((el: any, expectedMessage: string) => {
        const doc = el.ownerDocument
        const view = doc.defaultView
        const card = el.querySelector(':scope > div')
        const input = el.querySelector('#category-name')
        const textarea = el.querySelector('#category-description')
        const alertNode = [...el.querySelectorAll('[role="alert"]')]
          .find(node => node.textContent?.includes(expectedMessage))
        const cardRect = card.getBoundingClientRect()
        const inputRect = input.getBoundingClientRect()
        const textareaRect = textarea.getBoundingClientRect()
        const alertRect = alertNode.getBoundingClientRect()
        const bodyTop = el.querySelector('form .overflow-y-auto').getBoundingClientRect().top
        return {
          docScroll: doc.documentElement.scrollWidth,
          viewportWidth: view.innerWidth,
          viewportHeight: view.innerHeight,
          cardLeft: cardRect.left,
          cardRight: cardRect.right,
          cardClient: card.clientWidth,
          cardScroll: card.scrollWidth,
          inputLeft: inputRect.left,
          inputRight: inputRect.right,
          textareaLeft: textareaRect.left,
          textareaRight: textareaRect.right,
          alertLeft: alertRect.left,
          alertRight: alertRect.right,
          alertTop: alertRect.top,
          alertBottom: alertRect.bottom,
          bodyTop,
          alertClient: alertNode.clientWidth,
          alertScroll: alertNode.scrollWidth,
        }
      }, longMessage)

      expect(metrics.docScroll, `documento a ${width}`).toBeLessThanOrEqual(metrics.viewportWidth)
      expect(metrics.cardScroll, `tarjeta a ${width}`).toBeLessThanOrEqual(metrics.cardClient + 1)
      expect(metrics.inputLeft, `input izquierda a ${width}`).toBeGreaterThanOrEqual(metrics.cardLeft - 1)
      expect(metrics.inputRight, `input derecha a ${width}`).toBeLessThanOrEqual(metrics.cardRight + 1)
      expect(metrics.textareaLeft, `textarea izquierda a ${width}`).toBeGreaterThanOrEqual(metrics.cardLeft - 1)
      expect(metrics.textareaRight, `textarea derecha a ${width}`).toBeLessThanOrEqual(metrics.cardRight + 1)
      expect(metrics.alertLeft, `alerta izquierda a ${width}`).toBeGreaterThanOrEqual(metrics.cardLeft - 1)
      expect(metrics.alertRight, `alerta derecha a ${width}`).toBeLessThanOrEqual(metrics.cardRight + 1)
      expect(metrics.alertTop, `alerta arriba a ${width}`).toBeGreaterThanOrEqual(0)
      expect(metrics.alertBottom, `alerta abajo a ${width}`).toBeLessThanOrEqual(metrics.viewportHeight)
      expect(metrics.alertBottom, `alerta no invade el cuerpo a ${width}`).toBeLessThanOrEqual(metrics.bodyTop + 1)
      expect(metrics.alertScroll, `alerta wrap a ${width}`).toBeLessThanOrEqual(metrics.alertClient + 1)
    }

    // Foco visible institucional en campo y botón principal.
    await page.setViewportSize({ width: 360, height: 700 })
    await nameInput.focus()
    const inputOutline = await nameInput.evaluate((el: any) => {
      const style = el.ownerDocument.defaultView.getComputedStyle(el)
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, offset: style.outlineOffset }
    })
    expect(inputOutline).toEqual({ width: '2px', style: 'solid', color: 'rgb(20, 90, 141)', offset: '2px' })

    const save = dialog.getByRole('button', { name: 'Guardar categoría' })
    await description.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(save).toBeFocused()
    const saveOutline = await save.evaluate((el: any) => {
      const style = el.ownerDocument.defaultView.getComputedStyle(el)
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, offset: style.outlineOffset }
    })
    expect(saveOutline).toEqual({ width: '2px', style: 'solid', color: 'rgb(20, 90, 141)', offset: '2px' })
  })
})
