import { test, expect } from '@playwright/test'
import { mockCart } from './helpers/cart-fixture'

const eligibleOrder = {
  elegible: true,
  moneda: 'USD' as const,
  totalUSD: '80.00',
  creditoDisponibleUSD: '500.00',
  codigo: null,
  mensaje: null,
  cotizacion: 'mock-signed-quote-token-for-e2e',
}

for (const width of [1280, 360]) {
  test(`confirma el pedido a crédito sin duplicar operaciones (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    const state = await mockCart(page)
    state.eligibility = eligibleOrder
    let releaseConfirmation = () => {}
    state.confirmGate = new Promise<void>(resolve => {
      releaseConfirmation = resolve
    })

    try {
      await page.goto('/carrito')
      const summary = page.getByRole('region', { name: 'Resumen del carrito' })
      const option = summary.getByRole('radio', { name: 'Cuenta corriente' })
      const confirm = summary.getByRole('button', {
        name: 'Confirmar pedido a cuenta corriente',
      })

      await option.check()
      await expect(summary).toContainText('Total del pedido')
      await expect(summary).toContainText('USD 80.00')
      await expect(summary).toContainText('USD 500.00')
      await expect(option).toBeVisible()
      await expect(confirm).toBeEnabled()
      const postObserved = page.waitForRequest(request =>
        request.method() === 'POST' && request.url().includes('/pedidos/cuenta-corriente'))
      await confirm.click()
      await postObserved
      const confirming = summary.getByRole('button', { name: 'Confirmando…' })
      await expect(confirming).toBeVisible()
      await expect(confirming).toBeDisabled()
      expect(state.orderRequests).toHaveLength(1)

      releaseConfirmation()
      await expect(page.getByText(
        'Pedido #456 confirmado por USD 80.00.',
        { exact: false },
      ).first()).toBeVisible()
      await expect(page.getByText('Tu carrito está vacío.')).toBeVisible()

      expect(state.orderRequests).toHaveLength(1)
      expect(state.orderRequests[0]).toMatchObject({
        method: 'POST',
        body: { cotizacion: 'mock-signed-quote-token-for-e2e' },
      })
      expect(state.orderRequests[0].key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
    } finally {
      releaseConfirmation()
    }
  })
}

test('mantiene transferencia disponible cuando el backend no habilita cuenta corriente', async ({
  page,
}) => {
  const state = await mockCart(page)
  await page.goto('/carrito')

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await expect(summary.getByRole('radio', {
    name: 'Cuenta corriente',
  })).toHaveCount(0)
  await expect(summary.getByRole('radio', { name: 'Transferencia' })).toBeVisible()
  await expect(summary.getByRole('button', {
    name: 'Confirmar pedido por transferencia',
  })).toBeEnabled()
  expect(state.orderRequests).toEqual([])
})

test('permite reconsultar crédito fallido sin bloquear transferencia ni habilitar crédito prematuramente', async ({ page }) => {
  const state = await mockCart(page)
  state.eligibility = eligibleOrder
  state.creditEligibilityFails = true
  await page.goto('/carrito')

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  const retry = summary.getByRole('button', { name: 'Volver a consultar elegibilidad' })
  const transfer = summary.getByRole('button', { name: 'Confirmar pedido por transferencia' })
  const credit = summary.getByRole('radio', { name: 'Cuenta corriente' })
  await expect(summary.getByRole('alert')).toContainText('No se pudo consultar el crédito.')
  await expect(transfer).toBeEnabled()
  await expect(credit).toHaveCount(0)
  const failedRetry = page.waitForResponse(response =>
    response.url().endsWith('/pedidos/cuenta-corriente/eligibilidad') && response.status() === 500)
  await retry.click()
  await failedRetry
  await expect(summary.getByRole('alert')).toContainText('No se pudo consultar el crédito.')
  await expect(retry).toBeVisible()
  await expect(credit).toHaveCount(0)

  let release = () => {}
  state.creditEligibilityFails = false
  state.creditEligibilityGate = new Promise<void>(resolve => { release = resolve })
  try {
    await retry.click()
    await expect(summary.getByRole('status').filter({ hasText: 'Verificando si este pedido' })).toBeVisible()
    await expect(credit).toHaveCount(0)
    await expect(transfer).toBeEnabled()
    expect(state.orderRequests).toEqual([])
    release()
    await expect(summary.getByRole('status').filter({
      hasText: 'Elegibilidad actualizada.',
    })).toBeVisible()
    await expect(credit).toBeVisible()
    await expect(summary.getByRole('alert')).toHaveCount(0)
    await expect(summary.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    await credit.check()
    await expect(summary.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' })).toBeEnabled()
  } finally {
    release()
  }
})

test('un reintento de crédito no elegible conserva transferencia y no habilita crédito', async ({ page }) => {
  const state = await mockCart(page)
  state.creditEligibilityFails = true
  await page.goto('/carrito')
  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await expect(summary.getByRole('alert')).toContainText('No se pudo consultar el crédito.')
  state.creditEligibilityFails = false
  await summary.getByRole('button', { name: 'Volver a consultar elegibilidad' }).click()
  await expect(summary.getByRole('alert')).toHaveCount(0)
  await expect(summary.getByRole('radio', { name: 'Cuenta corriente' })).toHaveCount(0)
  await expect(summary.getByRole('button', { name: 'Confirmar pedido por transferencia' })).toBeEnabled()
  expect(state.orderRequests).toEqual([])
})

test('muestra el rechazo real de crédito insuficiente', async ({ page }) => {
  const state = await mockCart(page)
  state.eligibility = eligibleOrder
  state.confirmationStatus = 409
  await page.goto('/carrito')

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await summary.getByRole('radio', { name: 'Cuenta corriente' }).check()
  await summary.getByRole('button', {
    name: 'Confirmar pedido a cuenta corriente',
  }).click()

  await expect(summary.getByRole('alert')).toContainText(
    'El crédito disponible no alcanza para confirmar este pedido.',
  )
  await expect(summary.getByRole('radio', { name: 'Cuenta corriente' })).toHaveCount(0)
  await expect(summary.getByRole('radio', { name: 'Transferencia' })).toBeVisible()
  expect(state.orderRequests).toHaveLength(1)
})

test('oculta cuenta corriente cuando el backend rechaza elegibilidad y conserva transferencia', async ({
  page,
}) => {
  const state = await mockCart(page)
  state.eligibility = {
    elegible: false,
    moneda: 'USD',
    totalUSD: '80.00',
    creditoDisponibleUSD: '20.00',
    codigo: 'CREDITO_INSUFICIENTE',
    mensaje: 'El crédito disponible no alcanza para confirmar el pedido.',
    cotizacion: null,
  }
  await page.goto('/carrito')

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await expect(summary.getByRole('radio', {
    name: 'Cuenta corriente',
  })).toHaveCount(0)
  await expect(summary.getByRole('radio', { name: 'Transferencia' })).toBeVisible()
  await expect(summary).toContainText('Total a transferir')
  await expect(summary).toContainText('USD 80.00')
  expect(state.orderRequests).toEqual([])
})

test('recupera un resultado pendiente con la misma clave idempotente', async ({
  page,
}) => {
  const state = await mockCart(page)
  state.eligibility = eligibleOrder
  state.confirmationStatus = 202
  state.recoveryStatus = 202
  await page.goto('/carrito')

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await summary.getByRole('radio', { name: 'Cuenta corriente' }).check()
  await summary.getByRole('button', {
    name: 'Confirmar pedido a cuenta corriente',
  }).click()
  await expect(summary).toContainText('todavía no tiene un resultado definitivo')

  const key = state.orderRequests[0]?.key
  expect(key).toBeTruthy()
  expect(state.orderRequests).toHaveLength(1)

  state.recoveryStatus = 200
  await summary.getByRole('button', { name: 'Consultar resultado' }).click()

  await expect(page.getByText('Pedido #456 confirmado por USD 80.00')).toBeVisible()
  expect(state.recoveryRequests).toEqual([key])
  expect(state.orderRequests).toHaveLength(1)
})

test('H04: ofrece consultar un intento pendiente incluso con el carrito vacío', async ({ page }) => {
  const state = await mockCart(page)
  state.removed = true
  state.recoveryStatus = 404
  const key = 'd01e9632-24a2-4ad7-a2ba-d383f8f3edbc'
  await page.addInitScript(({ storageKey, value }) => sessionStorage.setItem(storageKey, value), {
    storageKey: 'account-order:2',
    value: JSON.stringify({ key, quoteToken: eligibleOrder.cotizacion }),
  })
  await page.goto('/carrito')
  const content = page.getByRole('region', { name: 'Contenido del carrito' })
  await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()
  await expect(content.getByRole('button', { name: 'Consultar resultado' })).toBeVisible()
  await content.getByRole('button', { name: 'Consultar resultado' }).click()
  await expect(content).toContainText('Conservamos el mismo identificador')
  expect(state.recoveryRequests).toEqual([key, key])
})

test('H05: al recuperar confirmación, conserva comprobante si falla recargar el carrito', async ({ page }) => {
  const state = await mockCart(page)
  state.eligibility = eligibleOrder
  state.confirmationStatus = 202
  state.recoveryStatus = 200
  await page.goto('/carrito')
  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await summary.getByRole('radio', { name: 'Cuenta corriente' }).check()
  await summary.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
  await expect(summary).toContainText('todavía no tiene un resultado definitivo')
  state.failCartReadOnRecovery = true
  await summary.getByRole('button', { name: 'Consultar resultado' }).click()
  await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' }))
    .toContainText('Pedido #456 confirmado por USD 80.00.')
  const content = page.getByRole('region', { name: 'Contenido del carrito' })
  await expect(content.getByRole('alert').filter({ hasText: 'servidor no pudo procesar el carrito' }))
    .toContainText('servidor no pudo procesar el carrito')
  await content.getByRole('button', { name: 'Volver a consultar carrito' }).click()
  await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()
  expect(state.recoveryRequests).toHaveLength(1)
})
