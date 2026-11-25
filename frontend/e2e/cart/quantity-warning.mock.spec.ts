import { test, expect } from '@playwright/test'
import { mockCart } from './helpers/cart-fixture'

const summaryText = 'Volvé a consultar el carrito'
const lineWarning = 'Stock y precio pendientes de confirmar.'

type CartWarningBrowser = typeof globalThis & {
  __cartWarnings?: string[]
  document: { body: { innerText: string } }
  MutationObserver: new (callback: () => void) => {
    observe(target: unknown, options: Record<string, boolean>): void
  }
}

test('una actualización exitosa no muestra advertencias transitorias de resincronización', async ({
  page,
}) => {
  const state = await mockCart(page)
  await page.goto('/carrito')

  const content = page.getByRole('region', { name: 'Contenido del carrito' })
  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  const quantity = content.getByRole('spinbutton', { name: 'Cantidad de Producto de prueba' })
  const increase = content.getByRole('button', {
    name: 'Aumentar cantidad de Producto de prueba',
  })

  await expect(quantity).toHaveValue('1')
  await expect(summary).toContainText('USD 80.00')

  // Registra cualquier aparición de las advertencias durante toda la operación,
  // incluso si el texto se retira antes de que Playwright vuelva a consultar.
  await page.evaluate(() => {
    const phrases = [
      'Volvé a consultar el carrito',
      'Stock y precio pendientes de confirmar.',
    ]
    const browser = globalThis as CartWarningBrowser
    const seen: string[] = []
    browser.__cartWarnings = seen
    const scan = () => {
      const text = browser.document.body.innerText
      for (const phrase of phrases) {
        if (text.includes(phrase) && !seen.includes(phrase)) seen.push(phrase)
      }
    }
    new browser.MutationObserver(scan).observe(browser.document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    scan()
  })

  let releaseMutation!: () => void
  state.mutationGate = new Promise<void>(resolve => { releaseMutation = resolve })
  const write = page.waitForRequest(request =>
    new URL(request.url()).pathname === '/api/carrito/items/1' &&
    request.method() === 'PATCH')

  await increase.click()
  await write
  await expect(content.getByRole('status').filter({ hasText: 'Actualizando carrito…' }))
    .toBeVisible()
  await expect(increase).toBeDisabled()
  await expect(page.getByText(summaryText, { exact: false })).toHaveCount(0)
  await expect(page.getByText(lineWarning, { exact: true })).toHaveCount(0)

  // La relectura posterior también es parte de la misma actualización exitosa:
  // retiene la cantidad anterior, pero no debe presentarla como no verificada.
  let releaseRead!: () => void
  state.readGate = new Promise<void>(resolve => { releaseRead = resolve })
  releaseMutation()

  await expect(quantity).toHaveValue('1')
  await expect(content.getByRole('status').filter({ hasText: 'Actualizando carrito…' }))
    .toBeVisible()
  await expect(page.getByText(summaryText, { exact: false })).toHaveCount(0)
  await expect(page.getByText(lineWarning, { exact: true })).toHaveCount(0)

  releaseRead()
  await expect(quantity).toHaveValue('2')
  await expect(increase).toBeEnabled()
  await expect(summary).toContainText('USD 160.00')
  await expect(page.getByText(summaryText, { exact: false })).toHaveCount(0)
  await expect(page.getByText(lineWarning, { exact: true })).toHaveCount(0)

  expect(state.writes).toEqual([{ method: 'PATCH', quantity: 2 }])
  expect(await page.evaluate(() =>
    (globalThis as CartWarningBrowser).__cartWarnings ?? [],
  )).toEqual([])
})

test('una relectura fallida sí conserva la advertencia real y el reintento', async ({
  page,
}) => {
  const state = await mockCart(page)
  await page.goto('/carrito')

  const content = page.getByRole('region', { name: 'Contenido del carrito' })
  const quantity = content.getByRole('spinbutton', { name: 'Cantidad de Producto de prueba' })

  await expect(quantity).toHaveValue('1')

  state.failCartReadOnRecovery = true
  await content.getByRole('button', {
    name: 'Aumentar cantidad de Producto de prueba',
  }).click()

  // La escritura fue aceptada, pero la relectura falla: el carrito queda
  // explícitamente pendiente y ofrece volver a consultarlo.
  await expect(content.getByText(lineWarning, { exact: true })).toBeVisible()
  await expect(content.getByRole('alert')).toContainText('El servidor no pudo procesar el carrito.')
  await expect(content.getByRole('button', { name: 'Volver a consultar carrito' })).toBeVisible()
  await expect(quantity).toHaveValue('1')

  await content.getByRole('button', { name: 'Volver a consultar carrito' }).click()
  await expect(quantity).toHaveValue('2')
  await expect(content.getByText(lineWarning, { exact: true })).toHaveCount(0)
})
