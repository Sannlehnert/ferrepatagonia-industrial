import { test, expect } from '@playwright/test'
import { mockCart } from './helpers/cart-fixture'

test('muestra la imagen del producto cuando carga correctamente', async ({
  page,
}) => {
  const state = await mockCart(page)

  state.transform = value => {
    value.items[0]!.imagen = '/cart-test.svg'
    return value
  }

  await page.route('**/cart-test.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'
      + '<rect width="16" height="16" fill="navy"/></svg>',
  }))

  await page.goto('/carrito')

  const image = page.getByRole('img', {
    name: 'Producto de prueba',
    exact: true,
  })

  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty('naturalWidth', 16)
  await expect(page.getByText('Sin imagen', {
    exact: true,
  })).toHaveCount(0)
})

test('muestra una alternativa cuando falla la imagen', async ({ page }) => {
  const state = await mockCart(page)

  state.transform = value => {
    value.items[0]!.imagen = '/cart-broken.png'
    return value
  }

  await page.route('**/cart-broken.png', route => route.abort())
  await page.goto('/carrito')

  await expect(page.getByText('Sin imagen', {
    exact: true,
  })).toBeVisible()
  await expect(page.getByRole('img', {
    name: 'Producto de prueba',
    exact: true,
  })).toHaveCount(0)
})

for (const scenario of ['sin stock', 'sin precio'] as const) {
  test(`producto ${scenario}: informa el estado y bloquea cantidades`, async ({
    page,
  }) => {
    const state = await mockCart(page)

    state.transform = value => {
      const item = value.items[0]!

      if (scenario === 'sin stock') {
        item.stock = 0
        item.disponible = false
        item.motivo_no_disponible = 'SIN_STOCK'
      } else {
        item.precio = null
        item.error_precio = 'PRECIO_AUSENTE'
      }

      value.tiene_incompatibles = true
      value.totalUSD = null
      value.estado_total = 'ITEMS_INCOMPATIBLES'
      return value
    }

    await page.goto('/carrito')

    const content = page.getByRole('region', {
      name: 'Contenido del carrito',
    })

    await expect(content.getByText(
      scenario === 'sin stock' ? 'Sin stock.' : 'Precio no disponible.',
      { exact: true },
    )).toBeVisible()

    await expect(content.getByRole('spinbutton')).toBeDisabled()
    await expect(content.getByRole('button', {
      name: 'Aumentar cantidad de Producto de prueba',
    })).toBeDisabled()
    await expect(content.getByRole('button', {
      name: 'Disminuir cantidad de Producto de prueba',
    })).toBeDisabled()

    const summary = content.getByRole('region', {
      name: 'Resumen del carrito',
    })
    await expect(summary).toContainText('Pendiente de confirmar')
    await expect(summary).not.toContainText('USD 80.00')
    await expect(summary.getByRole('button', {
      name: 'Finalizar compra',
    })).toBeDisabled()

    // Un producto incompatible debe poder retirarse del carrito.
    await content.getByRole('button', {
      name: 'Eliminar Producto de prueba del carrito',
    }).click()
    await expect(content.getByText('Tu carrito está vacío.', {
      exact: true,
    })).toBeVisible()
  })
}

test('informa la carga mientras espera la respuesta', async ({ page }) => {
  const state = await mockCart(page)
  let release = () => {}

  state.readGate = new Promise<void>(resolve => {
    release = resolve
  })

  try {
    await page.goto('/carrito', { waitUntil: 'domcontentloaded' })

    const content = page.getByRole('region', {
      name: 'Contenido del carrito',
    })

    await expect(content).toHaveAttribute('aria-busy', 'true')
    await expect(content.getByText('Consultando carrito…', {
      exact: true,
    })).toBeVisible()
    await expect(content.getByRole('spinbutton')).toHaveCount(0)

    release()

    await expect(content).toHaveAttribute('aria-busy', 'false')
    await expect(content.getByRole('spinbutton')).toBeEnabled()
  } finally {
    release()
  }
})

test('permite reintentar una consulta fallida y recupera el carrito', async ({
  page,
}) => {
  const state = await mockCart(page)
  state.readFailures = 1

  await page.goto('/carrito')

  const content = page.getByRole('region', {
    name: 'Contenido del carrito',
  })

  await expect(content.getByRole('alert')).toContainText(
    'El servidor no pudo procesar el carrito.',
  )
  await expect(content.getByRole('spinbutton')).toHaveCount(0)

  await content.getByRole('button', {
    name: 'Volver a consultar carrito',
  }).click()

  await expect(content.getByRole('alert')).toHaveCount(0)
  await expect(content.getByRole('spinbutton')).toHaveValue('1')
  await expect(content.getByRole('spinbutton')).toBeEnabled()
  expect(state.writes).toEqual([])
})