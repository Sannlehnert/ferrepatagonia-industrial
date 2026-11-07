import type { Page } from '@playwright/test'
import type { CartSnapshot } from '../../../src/types/cart'

export async function mockCart(page: Page) {
  const state = {
    quantity: 1,
    removed: false,
    writes: [] as Array<{ method: string; quantity?: number }>,
  }

  const amounts: Record<number, string> = {
    1: '80.00',
    2: '160.00',
    3: '240.00',
  }

  function snapshot(): CartSnapshot {
    return {
      id_carrito: 1,
      items: state.removed ? [] : [{
        id_item_carrito: 1,
        id_producto: 1,
        codigo: 'TEST-CART-1',
        nombre: 'Producto de prueba',
        imagen: null,
        cantidad: state.quantity,
        stock: 3,
        disponible: true,
        precio: {
          estadoPrecio: 'DEFINIDO',
          precioComprable: true,
          precioUnitarioUSD: '80.00',
          subtotalUSD: amounts[state.quantity]!,
          descuentoAplicado: '20.00',
          origenDescuento: 'LISTA',
          datosSinteticos: false,
        },
        error_precio: null,
      }],
      total_items: state.removed ? 0 : state.quantity,
      tiene_incompatibles: false,
      moneda: 'USD',
      regla: 'FER17-v1',
      ivaIncluido: true,
      totalUSD: state.removed ? '0.00' : amounts[state.quantity]!,
      estado_total: 'DEFINIDO',
    }
  }

  // Datos exclusivos de pruebas HTTP interceptadas.
  // No se insertan productos ni evidencias en una base de datos.
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()

    if (path === '/api/auth/me') {
      return route.fulfill({
        json: {
          user: {
            id: 2,
            rol: 'CLIENTE',
            email: 'cart-ui@example.test',
            nombre_razon_social: 'Cliente de prueba',
            tipo_cliente: 'PARTICULAR',
          },
        },
      })
    }

    if (path === '/api/carrito' && method === 'GET') {
      return route.fulfill({ json: snapshot() })
    }

    if (path === '/api/carrito/items/1' && method === 'PATCH') {
      const { cantidad } = request.postDataJSON()

      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 3) {
        return route.fulfill({
          status: 422,
          json: { message: 'Cantidad inválida.' },
        })
      }

      state.quantity = cantidad
      state.writes.push({ method, quantity: cantidad })
      return route.fulfill({ status: 204 })
    }

    if (path === '/api/carrito/items/1' && method === 'DELETE') {
      state.removed = true
      state.writes.push({ method })
      return route.fulfill({ status: 204 })
    }

    return route.abort()
  })

  return state
}