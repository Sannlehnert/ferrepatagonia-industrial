import { test, expect } from '@playwright/test'
import { mockCart } from './helpers/cart-fixture'

test('registra una orden de transferencia pendiente y ofrece adjuntar el comprobante', async ({ page }) => {
  const state = await mockCart(page)
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/carrito')

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await expect(summary.getByRole('radio', { name: 'Transferencia' })).toBeVisible()
  await expect(summary.getByRole('radio', { name: 'Cuenta corriente' })).toHaveCount(0)
  await expect(summary).toContainText('NO-TRANSFERIR-DEMO')
  await expect(summary).toContainText('no realizar transferencias')
  const transferRequest = page.waitForRequest(request =>
    request.method() === 'POST' && request.url().endsWith('/api/pedidos/transferencia'))
  await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()

  await transferRequest
  await expect(page.getByRole('status').filter({
    hasText: 'El pago por transferencia está pendiente de acreditación',
  })).toContainText('no significa que el pago haya sido aprobado')

  const receipts = page.getByRole('region', { name: 'Comprobantes de pago' })
  await expect(receipts.getByRole('button', { name: 'Adjuntar comprobante' })).toBeVisible()
  expect(state.transferRequests).toHaveLength(1)
  expect(state.transferRequests[0]).toMatchObject({
    method: 'POST',
    body: { cotizacion: 'mock-transfer-quote-token-for-e2e' },
  })
  expect(state.transferRequests[0]?.key).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
})

test('mantiene el intento de transferencia pendiente sin declararlo pago aprobado', async ({ page }) => {
  const state = await mockCart(page)
  state.transferConfirmationStatus = 202
  await page.goto('/carrito')

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
  await expect(summary).toContainText('Todavía no pudimos verificar si el pedido quedó registrado')
  await expect(summary.getByRole('button', { name: 'Consultar resultado' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Comprobantes de pago' })).toHaveCount(0)
  expect(state.transferRequests).toHaveLength(1)
})
