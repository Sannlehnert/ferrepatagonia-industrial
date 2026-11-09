import { test, expect } from '@playwright/test'
import { mockCart } from './helpers/cart-fixture'

for (const width of [1280, 360]) {
  test.describe(`carrito con contrato interceptado: ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test('actualiza cantidades, respeta stock y permite eliminar', async ({
      page,
    }) => {
      const state = await mockCart(page)
      await page.goto('/carrito')

      const content = page.getByRole('region', {
        name: 'Contenido del carrito',
      })
      const quantity = content.getByRole('spinbutton', {
        name: 'Cantidad de Producto de prueba',
      })
      const increase = content.getByRole('button', {
        name: 'Aumentar cantidad de Producto de prueba',
      })
      const decrease = content.getByRole('button', {
        name: 'Disminuir cantidad de Producto de prueba',
      })

      await expect(quantity).toBeEnabled()
      await expect(quantity).toHaveValue('1')
      await expect(decrease).toBeDisabled()

      await increase.click()
      await expect(quantity).toHaveValue('2')
      await expect(quantity).toBeEnabled()
      await expect(content.getByRole('region', {
        name: 'Resumen del carrito',
      })).toContainText('USD 160.00')

      await quantity.fill('4')
      await quantity.press('Tab')
      await expect(content.getByRole('alert')).toContainText(
        'Ingresá una cantidad entre 1 y 3.',
      )
      expect(state.writes).toEqual([
        { method: 'PATCH', quantity: 2 },
      ])

      await quantity.fill('3')
      await quantity.press('Tab')
      await expect(quantity).toHaveValue('3')
      await expect(quantity).toBeEnabled()
      await expect(increase).toBeDisabled()

      await decrease.click()
      await expect(quantity).toHaveValue('2')
      await expect(quantity).toBeEnabled()

      await expect(content.getByRole('button', {
        name: 'Finalizar compra',
      })).toBeDisabled()

      await content.getByRole('button', {
        name: 'Eliminar Producto de prueba del carrito',
      }).click()

      await expect(content.getByText(
        'Tu carrito está vacío.',
        { exact: true },
      )).toBeVisible()

      expect(state.writes).toEqual([
        { method: 'PATCH', quantity: 2 },
        { method: 'PATCH', quantity: 3 },
        { method: 'PATCH', quantity: 2 },
        { method: 'DELETE' },
      ])
    })

    test('abre el panel, cierra con Escape y recupera el foco', async ({
      page,
    }) => {
      await mockCart(page)
      await page.goto('/carrito')

      const trigger = page.getByRole('button', {
        name: 'Carrito',
        exact: true,
      })
      await trigger.click()

      const dialog = page.getByRole('dialog', {
        name: 'Tu carrito',
      })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('link', {
        name: 'Ver carrito completo',
      })).toBeVisible()

      const bounds = await dialog.boundingBox()

      expect(bounds).not.toBeNull()

      if (bounds) {
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      }

      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
    })
  })
}