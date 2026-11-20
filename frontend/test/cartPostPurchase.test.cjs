const assert = require('node:assert/strict')
const { test } = require('node:test')
const { randomUUID } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')
const { AxiosError } = require('axios')
const { createPinia, disposePinia } = require('pinia')

const tick = () => new Promise(done => setImmediate(done))
const result = {
  estado: 'CONFIRMADO', pedidoId: 325, modalidadPago: 'CUENTA_CORRIENTE',
  moneda: 'USD', totalUSD: '20.00', cargoId: '325', venceEl: '2026-12-09',
}
const quote = {
  elegible: true, moneda: 'USD', totalUSD: '20.00', creditoDisponibleUSD: '100.00',
  codigo: null, mensaje: null, cotizacion: 'test-only-signed-quote',
}
const failure = (status, data) => new AxiosError('Test-only failure', undefined, undefined,
  undefined, { status, data })
function snapshot(quantity) {
  return {
    id_carrito: 325, total_items: quantity, tiene_incompatibles: false,
    moneda: 'USD', regla: 'FER17-v1', ivaIncluido: true,
    totalUSD: `${quantity * 10}.00`, estado_total: 'DEFINIDO',
    items: quantity ? [{
      id_item_carrito: 325, id_producto: 325, codigo: 'TEST-325', nombre: 'Producto de prueba',
      imagen: null, cantidad: quantity, stock: 10, disponible: true, error_precio: null,
      precio: { estadoPrecio: 'DEFINIDO', precioComprable: true, datosSinteticos: false,
        precioUnitarioUSD: '10.00', subtotalUSD: `${quantity * 10}.00`,
        descuentoAplicado: '0.00', origenDescuento: 'LISTA' },
    }] : [],
  }
}

// Ambos stores son los de producción. Solo se sustituyen transporte, almacenamiento y avisos externos.
function runtime(t, backend, saved = new Map(), Controller = AbortController) {
  const pinia = createPinia()
  t.after(() => disposePinia(pinia))
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const source = readFileSync(resolve(__dirname, '../src', file + '.ts'), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', 'AbortController', outputText)(name => {
      if (name === '@/services/api') return { __esModule: true, default: {} }
      if (name === '@/services/realtime') return { onRealtime() {} }
      return name.startsWith('@/') ? load(name.slice(2)) : require(name)
    }, module, module.exports, Controller)
    cache.set(file, module.exports)
    return module.exports
  }
  const auth = load('stores/auth').useAuthStore(pinia)
  auth.$patch({ user: { id: 325, rol: 'CLIENTE' }, sessionChecked: true })
  const cartModule = load('stores/cart')
  const reads = []
  const writes = []
  cartModule.useCartStore = cartModule.createCartStore({
    get: signal => {
      reads.push(signal)
      return backend.read ? backend.read(signal) : Promise.resolve(snapshot(backend.quantity))
    },
    mutate: async (command, signal) => {
      writes.push({ command, signal })
      if (!backend.mutate) assert.fail('La reconciliación no debe escribir en el carrito')
      return backend.mutate(command, signal)
    },
  })
  const cart = cartModule.useCartStore(pinia)
  const order = load('stores/accountOrder').createAccountOrderStore({
    getEligibility: async () => quote,
    confirm: async key => {
      backend.posts.push(key)
      if (backend.confirm) return backend.confirm(key)
      backend.quantity = 0
      return { estado: 'CONFIRMADO', result }
    },
    recover: async key => {
      backend.recoveries.push(key)
      return { estado: 'CONFIRMADO', result }
    },
  }, {
    get: id => saved.get(id) ?? null,
    set: (id, key, quoteToken) => saved.set(id, JSON.stringify({ key, quoteToken })),
    remove: id => saved.delete(id),
  }, randomUUID)(pinia)
  return { auth, cart, order, saved, reads, writes }
}
const server = () => ({ quantity: 2, posts: [], recoveries: [] })

test('#325: confirmación descarta ítems consumidos y usa el carrito devuelto por el servidor', async t => {
  const backend = server()
  const { cart, order, saved } = runtime(t, backend)
  await tick()
  assert.equal(cart.items[0].cantidad, 2)
  assert.equal(await order.confirm(), true)
  await tick()
  assert.deepEqual(cart.cart, snapshot(0))
  assert.equal(cart.needsSync, false)
  assert.equal(order.receipts.length, 1)
  assert.equal(saved.size, 0)
  assert.equal(backend.posts.length, 1)
})

test('#325: rechazo comercial conserva los ítems y no acredita una compra', async t => {
  const backend = server()
  backend.confirm = async () => {
    throw failure(409, { estado: 'RECHAZADO', code: 'CREDITO_INSUFICIENTE', message: 'Crédito insuficiente.' })
  }
  const { cart, order, saved } = runtime(t, backend)
  await tick()
  assert.equal(await order.confirm(), false)
  await tick()
  assert.deepEqual(cart.cart, snapshot(2))
  assert.equal(backend.quantity, 2)
  assert.equal(order.attemptState, 'rejected')
  assert.deepEqual(order.receipts, [])
  assert.equal(saved.size, 0)
})

test('#325: doble envío y respuesta perdida conservan la clave; recarga recupera sin otro POST', async t => {
  const backend = server()
  let release
  const gate = new Promise(done => { release = done })
  backend.confirm = async () => {
    backend.quantity = 0
    await gate
    throw failure(undefined, undefined)
  }
  const initial = runtime(t, backend)
  await tick()
  const pending = initial.order.confirm()
  assert.equal(await initial.order.confirm(), false)
  assert.equal(backend.posts.length, 1)
  release()
  assert.equal(await pending, false)
  assert.equal(initial.order.attemptState, 'pending')
  assert.deepEqual(initial.cart.cart, snapshot(2))
  const savedKey = JSON.parse(initial.saved.get(325)).key
  assert.equal(savedKey, backend.posts[0])

  // Otros ítems agregados después de esa compra deben sobrevivir a su recuperación.
  backend.quantity = 1
  const reloaded = runtime(t, backend, initial.saved)
  await tick()
  assert.deepEqual(backend.recoveries, [savedKey])
  assert.equal(backend.posts.length, 1)
  assert.equal(reloaded.order.confirmation.pedidoId, result.pedidoId)
  assert.equal(reloaded.order.receipts.length, 1)
  assert.deepEqual(reloaded.cart.cart, snapshot(1))
  assert.equal(reloaded.saved.size, 0)
})

for (const cancellationWorks of [true, false]) {
test(`#325: lectura anterior no repone ítems con cancelación ${cancellationWorks ? 'efectiva' : 'sin efecto'}`, async t => {
  const backend = server()
  let cancellationAttempts = 0
  // Solo este runtime recibe el controlador simulado; no se altera el global.
  class UncancellableController extends AbortController {
    abort() { cancellationAttempts++ }
  }
  const { cart, order, reads } = runtime(t, backend, new Map(),
    cancellationWorks ? AbortController : UncancellableController)
  await tick()
  let releaseOld
  const old = new Promise(done => { releaseOld = done })
  backend.read = () => {
    backend.read = undefined
    return old
  }
  const previousRead = cart.cargarCarrito()
  const previousSignal = reads.at(-1)
  assert.equal(await order.confirm(), true)
  await tick()
  assert.equal(previousSignal.aborted, cancellationWorks)
  if (!cancellationWorks) assert.ok(cancellationAttempts > 0)
  assert.deepEqual(cart.cart, snapshot(0))
  releaseOld(snapshot(2))
  assert.equal(await previousRead, false)
  assert.deepEqual(cart.cart, snapshot(0))
  assert.equal(cart.needsSync, false)
  assert.equal(cart.loading, false)
  assert.equal(order.attemptState, 'confirmed')
  assert.equal(backend.posts.length, 1)
})
}

for (const responseLost of [false, true]) {
  test(`#325: escritura pendiente al confirmar conserva ítems posteriores con respuesta ${responseLost ? 'perdida' : 'recibida'}`, async t => {
    const backend = server()
    let releaseWrite
    const pendingWrite = new Promise(done => { releaseWrite = done })
    backend.mutate = async command => {
      await pendingWrite
      // El servidor aplica esta adición después del COMMIT de la compra.
      backend.quantity += command.cantidad
      if (responseLost) throw failure(500, {})
    }
    const { cart, order, reads, writes, saved } = runtime(t, backend)
    await tick()
    const readsBefore = reads.length
    const writing = cart.agregarProducto(325, 1)
    try {
      assert.equal(writes.length, 1)
      assert.equal(cart.operation, 'add')
      assert.equal(await order.confirm(), true)
      await tick()
      assert.equal(backend.quantity, 0)
      assert.equal(cart.cart, null)
      assert.equal(cart.needsSync, true)
      assert.equal(cart.operation, 'add')
      assert.equal(writes[0].signal.aborted, false)
      assert.equal(reads.length, readsBefore, 'La confirmación debe esperar la escritura sin iniciar otro GET')
      assert.equal(writes.length, 1, 'La reconciliación no debe agregar ni vaciar ítems')
      assert.equal(order.attemptState, 'confirmed')
      assert.equal(order.confirmation.pedidoId, result.pedidoId)
    } finally {
      releaseWrite()
      await writing
    }
    assert.equal(await writing, !responseLost)
    assert.deepEqual(cart.cart, snapshot(1), 'Conserva la adición posterior sin reponer las dos unidades compradas')
    assert.equal(backend.quantity, 1)
    assert.equal(reads.length, readsBefore + 1)
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].command, { type: 'add', productoId: 325, cantidad: 1 })
    assert.equal(cart.operation, null)
    assert.equal(cart.loading, false)
    assert.equal(cart.needsSync, false)
    assert.equal(cart.loadError, '')
    assert.equal(Boolean(cart.operationError), responseLost)
    assert.equal(order.attemptState, 'confirmed')
    assert.equal(order.receipts.length, 1)
    assert.equal(saved.size, 0)
    assert.equal(backend.posts.length, 1)
    assert.deepEqual(backend.recoveries, [])
  })
}

test('#325: fallo de recarga conserva confirmación y reintenta solo la consulta del carrito', async t => {
  const backend = server()
  const { cart, order } = runtime(t, backend)
  await tick()
  backend.read = async () => {
    backend.read = undefined
    throw failure(500, {})
  }
  assert.equal(await order.confirm(), true)
  await tick()
  assert.equal(order.attemptState, 'confirmed')
  assert.equal(order.receipts.length, 1)
  assert.equal(cart.cart, null)
  assert.equal(cart.needsSync, true)
  assert.ok(cart.loadError)
  assert.equal(await cart.cargarCarrito(), true)
  assert.deepEqual(cart.cart, snapshot(0))
  assert.equal(backend.posts.length, 1)
  assert.deepEqual(backend.recoveries, [])
})
