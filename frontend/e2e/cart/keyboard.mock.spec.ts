import { test, expect } from '@playwright/test'
import { mockCart } from './helpers/cart-fixture'

for (const width of [1280, 360]) {
  test.describe(`carrito por teclado: ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test('recorre el panel y administra productos sin usar el mouse', async ({
      page,
    }) => {
      const state = await mockCart(page)
      await page.goto('/carrito')

      const trigger = page.getByRole('button', {
        name: 'Carrito',
        exact: true,
      })

      // Ubicar el inicio del recorrido; las acciones usan teclado.
      await trigger.focus()
      await page.keyboard.press('Enter')

      const dialog = page.getByRole('dialog', {
        name: 'Tu carrito',
      })
      const close = dialog.getByRole('button', {
        name: 'Cerrar carrito',
      })
      const drawerQuantity = dialog.getByRole('spinbutton')
      const drawerIncrease = dialog.getByRole('button', {
        name: 'Aumentar cantidad de Producto de prueba',
      })
      const drawerRemove = dialog.getByRole('button', {
        name: 'Eliminar Producto de prueba del carrito',
      })
      const fullCart = dialog.getByRole('link', {
        name: 'Ver carrito completo',
      })

      await expect(dialog).toBeVisible()
      await expect(drawerQuantity).toBeEnabled()
      await expect(close).toBeFocused()

      // En cantidad 1, Disminuir está deshabilitado y se omite.
      await page.keyboard.press('Tab')
      await expect(drawerQuantity).toBeFocused()

      await page.keyboard.press('Tab')
      await expect(drawerIncrease).toBeFocused()

      await page.keyboard.press('Tab')
      await expect(drawerRemove).toBeFocused()

      await page.keyboard.press('Tab')
      await expect(fullCart).toBeFocused()

      // El foco permanece dentro del diálogo en ambas direcciones.
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()

      await page.keyboard.press('Shift+Tab')
      await expect(fullCart).toBeFocused()

      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/carrito$/)
      await expect(dialog).toHaveCount(0)

      const quantity = page.getByRole('spinbutton', {
        name: 'Cantidad de Producto de prueba',
      })
      const decrease = page.getByRole('button', {
        name: 'Disminuir cantidad de Producto de prueba',
      })
      const increase = page.getByRole('button', {
        name: 'Aumentar cantidad de Producto de prueba',
      })
      const remove = page.getByRole('button', {
        name: 'Eliminar Producto de prueba del carrito',
      })

      await expect(quantity).toBeEnabled()
      await quantity.focus()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.press('2')
      await page.keyboard.press('Tab')

      await expect(quantity).toHaveValue('2')
      await expect(quantity).toBeEnabled()

      await decrease.focus()
      await page.keyboard.press('Space')
      await expect(quantity).toHaveValue('1')
      await expect(quantity).toBeEnabled()

      await increase.focus()
      await page.keyboard.press('Enter')
      await expect(quantity).toHaveValue('2')
      await expect(quantity).toBeEnabled()

      await remove.focus()
      await page.keyboard.press('Space')

      await expect(page.getByText('Tu carrito está vacío.', {
        exact: true,
      })).toBeVisible()

      expect(state.writes).toEqual([
        { method: 'PATCH', quantity: 2 },
        { method: 'PATCH', quantity: 1 },
        { method: 'PATCH', quantity: 2 },
        { method: 'DELETE' },
      ])
    })
  })
}