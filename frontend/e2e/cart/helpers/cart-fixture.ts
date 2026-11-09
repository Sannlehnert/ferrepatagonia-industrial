import type { Page } from '@playwright/test'
import type { CartSnapshot } from '../../../src/types/cart'
import type { AccountOrderEligibility } from '../../../src/types/accountOrder'

export async function mockCart(page: Page) {
  const state = {
    quantity: 1,
    removed: false,
    readFailures: 0,
    failCartReadOnRecovery: false,
    readGate: null as Promise<void> | null,
    confirmGate: null as Promise<void> | null,
    transform: null as ((value: CartSnapshot) => CartSnapshot) | null,
    writes: [] as Array<{ method: string; quantity?: number }>,
    eligibility: {
      elegible: false,
      moneda: 'USD',
      totalUSD: null,
      creditoDisponibleUSD: null,
      codigo: 'CUENTA_NO_HABILITADA',
      mensaje: 'El cliente no tiene una cuenta corriente habilitada.',
      cotizacion: null,
    } as AccountOrderEligibility,
    confirmationStatus: 201,
    recoveryStatus: 202,
    recoveryRequests: [] as string[],
    orderRequests: [] as Array<{ method: string; key?: string; body?: unknown }>,
  }

  const amounts: Record<number, string> = {
    1: '80.00',
    2: '160.00',
    3: '240.00',
  }

  function snapshot(): CartSnapshot {
    const value: CartSnapshot = {
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

    if (state.transform && value.items.length > 0) {
      return state.transform(value)
    }

    return value
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
      if (state.failCartReadOnRecovery) {
        state.failCartReadOnRecovery = false
        return route.fulfill({ status: 500, json: { message: 'Error al resincronizar.' } })
      }
      if (state.readGate) {
        await state.readGate
      }

      if (state.readFailures > 0) {
        state.readFailures--
        return route.fulfill({
          status: 500,
          json: { message: 'Error de prueba.' },
        })
      }

      return route.fulfill({ json: snapshot() })
    }

    if (path === '/api/pedidos/cuenta-corriente/eligibilidad' && method === 'GET') {
      return route.fulfill({ json: { data: state.eligibility } })
    }

    if (path === '/api/pedidos/cuenta-corriente' && method === 'POST') {
      state.orderRequests.push({
        method,
        key: request.headers()['idempotency-key'],
        body: request.postDataJSON(),
      })
      if (state.confirmGate) await state.confirmGate
      if (state.confirmationStatus === 409) {
        return route.fulfill({
          status: 409,
          json: {
            code: 'CREDITO_INSUFICIENTE',
            message: 'El crédito disponible no alcanza para confirmar este pedido.',
          },
        })
      }

      state.removed = true
      return route.fulfill({
        status: state.confirmationStatus,
        json: {
          data: {
            pedidoId: 456,
            estado: 'CONFIRMADO',
            modalidadPago: 'CUENTA_CORRIENTE',
            moneda: 'USD',
            totalUSD: amounts[state.quantity],
            cargoId: '789',
            venceEl: '2026-12-09',
          },
        },
      })
    }

    const recoveryKey = path.match(/^\/api\/pedidos\/cuenta-corriente\/([^/]+)$/)?.[1]
    if (recoveryKey && method === 'GET') {
      state.recoveryRequests.push(decodeURIComponent(recoveryKey))
      if (state.recoveryStatus === 202) {
        return route.fulfill({
          status: 202,
          json: {
            data: {
              estado: 'PENDIENTE',
              code: 'CONFIRMACION_PENDIENTE',
              message: 'Todavía no hay un resultado definitivo.',
            },
          },
        })
      }

      if (state.recoveryStatus === 404) {
        return route.fulfill({
          status: 404,
          json: { code: 'INTENTO_NO_ENCONTRADO', message: 'No se encontró el intento.' },
        })
      }

      state.removed = true
      return route.fulfill({
        status: 200,
        json: {
          data: {
            pedidoId: 456,
            estado: 'CONFIRMADO',
            modalidadPago: 'CUENTA_CORRIENTE',
            moneda: 'USD',
            totalUSD: amounts[state.quantity],
            cargoId: '789',
            venceEl: '2026-12-09',
          },
        },
      })
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
