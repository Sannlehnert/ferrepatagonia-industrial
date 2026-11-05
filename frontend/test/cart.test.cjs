const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { AxiosError } = require('axios')
const { createPinia, disposePinia } = require('pinia')

const user = (id, rol = 'CLIENTE') => ({ id, rol })
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function snapshot(id = 1, cantidad = 1, overrides = {}) {
  return {
    id_carrito: id,
    total_items: cantidad,
    tiene_incompatibles: !!overrides.motivo_no_disponible,
    items: cantidad ? [{
      id_item_carrito: id, id_producto: 7, codigo: 'SKU7', nombre: 'Producto',
      imagen: null, cantidad, stock: 10, disponible: true, ...overrides,
    }] : [],
  }
}
const httpError = status => new AxiosError('HTTP failure', undefined, undefined, undefined, { status })

function runtime(t, { read = async () => snapshot(), mutate, api = {}, restore } = {}) {
  const pinia = createPinia()
  t.after(() => disposePinia(pinia))
  const reads = []
  const writes = []
  const http = { ...api }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const source = fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    })
    const mod = { exports: {} }
    new Function('require', 'module', 'exports', outputText)(name => {
      if (name === '@/services/api') return { __esModule: true, default: http }
      return name.startsWith('@/') ? load(name.slice(2)) : require(name)
    }, mod, mod.exports)
    cache.set(file, mod.exports)
    return mod.exports
  }
  const auth = load('stores/auth').useAuthStore(pinia)
  if (restore) auth.$patch({ user: restore, sessionChecked: true })
  const { createCartStore, useCartStore } = load('stores/cart')
  const transport = {
    get(signal) {
      reads.push(signal)
      return read(signal)
    },
    ...(mutate && { mutate(command, signal) {
      writes.push(command)
      return mutate(command, signal)
    } }),
  }
  const cart = (api.get && !mutate ? useCartStore : createCartStore(transport))(pinia)
  return { auth, cart, reads, writes, http }
}

test('starts empty and restores a confirmed session without exposing unconfirmed data', async t => {
  const response = deferred()
  const { auth, cart, reads } = runtime(t, { read: () => response.promise })
  assert.equal(cart.cart, null)
  assert.deepEqual(cart.items, [])
  auth.user = user(1)
  await tick()
  assert.equal(reads.length, 0)
  auth.sessionChecked = true
  await tick()
  assert.equal(cart.loading, true)
  response.resolve(snapshot(1, 0))
  await tick()
  assert.deepEqual(cart.cart, snapshot(1, 0))
  assert.equal(cart.loading, false)
  assert.equal(cart.stockNeedsValidation, false)
  assert.equal(cart.pricesNeedValidation, true)
})

test('loads existing session, retains data on GET failure and supports explicit retry', async t => {
  let result = snapshot()
  const { cart } = runtime(t, { restore: user(1), read: async () => {
    if (result instanceof Error) throw result
    return result
  } })
  await tick()
  assert.deepEqual(cart.items, snapshot().items)
  result = httpError(500)
  assert.equal(await cart.cargarCarrito(), false)
  assert.match(cart.loadError, /servidor/)
  assert.equal(cart.needsSync, true)
  assert.deepEqual(cart.cart, snapshot())
  result = snapshot(1, 3)
  assert.equal(await cart.cargarCarrito(), true)
  assert.deepEqual(cart.cart, result)
  assert.equal(cart.loadError, '')
})

test('production GET uses the published unwrapped DTO and exposes unsupported writes', async t => {
  const requests = []
  const data = snapshot(1, 2, { stock: 1, motivo_no_disponible: 'SIN_STOCK' })
  const { cart } = runtime(t, { restore: user(1), api: {
    async get(url, config) {
      requests.push({ url, config })
      return { data }
    },
  } })
  await tick()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/carrito')
  assert.deepEqual(Object.keys(requests[0].config), ['signal'])
  assert.deepEqual(cart.cart, data)
  assert.equal(await cart.agregarProducto(7, 1), false)
  assert.match(cart.operationError, /todavía no están disponibles/)
  assert.equal(requests.length, 1)
})

test('uses only product and quantity commands and syncs all three operations', async t => {
  let quantity = 1
  const pending = deferred()
  const { cart, writes, reads } = runtime(t, { restore: user(1),
    read: async () => snapshot(1, quantity),
    async mutate(command) {
      if (command.type === 'add') await pending.promise
      quantity = command.type === 'remove' ? 0 : command.cantidad
    },
  })
  await tick()
  for (const invalid of [0, -1, 1.25, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(await cart.agregarProducto(7, invalid), false)
  }
  assert.equal(await cart.quitarProducto(0), false)
  assert.equal(writes.length, 0)
  const add = cart.agregarProducto(7, 2)
  assert.equal(cart.operation, 'add')
  assert.equal(cart.stockNeedsValidation, true)
  assert.equal(cart.pricesNeedValidation, true)
  assert.equal(cart.items[0].cantidad, 1)
  assert.equal(await cart.agregarProducto(7, 2), false)
  assert.equal(await cart.actualizarCantidad(7, 9), false)
  assert.equal(await cart.cargarCarrito(), false)
  pending.resolve()
  assert.equal(await add, true)
  assert.equal(cart.items[0].cantidad, 2)
  assert.equal(await cart.actualizarCantidad(7, 4), true)
  assert.equal(cart.items[0].cantidad, 4)
  assert.equal(await cart.quitarProducto(7), true)
  assert.deepEqual(cart.items, [])
  assert.equal(cart.stockNeedsValidation, false)
  assert.equal(reads.length, 4)
  assert.deepEqual(writes, [
    { type: 'add', productoId: 7, cantidad: 2 },
    { type: 'update', productoId: 7, cantidad: 4 },
    { type: 'remove', productoId: 7 },
  ])
})

for (const [status, message, reason] of [
  [400, /no es válida/],
  [401, /Iniciá sesión/],
  [403, /no tiene acceso/],
  [404, /no está disponible/],
  [409, /disponibilidad cambiaron/, 'SIN_STOCK'],
  [422, /no admite/, 'INACTIVO'],
  [500, /servidor/],
]) {
  test(`maps HTTP ${status} and reconciles with authoritative GET`, async t => {
    let data = snapshot()
    const { cart, writes } = runtime(t, { restore: user(1),
      read: async () => data,
      async mutate() {
        if (reason) data = snapshot(1, 1, { motivo_no_disponible: reason, disponible: false })
        throw httpError(status)
      },
    })
    await tick()
    assert.equal(await cart.actualizarCantidad(7, 2), false)
    assert.match(cart.operationError, message)
    assert.equal(writes.length, 1)
    assert.equal(cart.needsSync, false)
    assert.deepEqual(cart.cart, data)
  })
}

test('network failure can follow a committed write; failed reconciliation preserves the prior snapshot', async t => {
  let count = 1
  let failRead = false
  const { cart, writes } = runtime(t, { restore: user(1),
    async read() {
      if (failRead) throw new Error('offline')
      return snapshot(1, count)
    },
    async mutate() {
      count = 3
      failRead = true
      throw new Error('response lost')
    },
  })
  await tick()
  assert.equal(await cart.agregarProducto(7, 2), false)
  assert.match(cart.operationError, /conexión/)
  assert.match(cart.loadError, /conexión/)
  assert.equal(cart.items[0].cantidad, 1)
  assert.equal(cart.stockNeedsValidation, true)
  assert.equal(await cart.agregarProducto(7, 2), false)
  assert.equal(writes.length, 1)
  failRead = false
  assert.equal(await cart.cargarCarrito(), true)
  assert.equal(cart.items[0].cantidad, 3)
  assert.equal(cart.needsSync, false)
})

test('ignores reads that complete after logout or a change of identity even if abort is ignored', async t => {
  const first = deferred()
  const third = deferred()
  let calls = 0
  const { auth, cart, reads } = runtime(t, { restore: user(1),
    read: () => [first.promise, Promise.resolve(snapshot(2)), third.promise][calls++],
  })
  await tick()
  auth.user = user(2)
  assert.equal(reads[0].aborted, true)
  assert.equal(cart.cart, null)
  await tick()
  first.resolve(snapshot(1))
  await tick()
  assert.equal(cart.cart.id_carrito, 2)
  const pending = cart.cargarCarrito()
  auth.clear()
  assert.equal(cart.cart, null)
  assert.equal(reads[2].aborted, true)
  third.resolve(snapshot(2))
  assert.equal(await pending, false)
  assert.deepEqual(cart.items, [])
  assert.equal(cart.loadError, '')
})

test('ignores late mutation and does not reconcile into a new identity', async t => {
  const pending = deferred()
  let id = 1
  const { auth, cart, reads, writes } = runtime(t, { restore: user(1),
    read: async () => snapshot(id),
    mutate: () => pending.promise,
  })
  await tick()
  const mutation = cart.quitarProducto(7)
  id = 2
  auth.user = user(id)
  assert.equal(cart.operation, null)
  await tick()
  pending.resolve()
  assert.equal(await mutation, false)
  assert.equal(reads.length, 2)
  assert.equal(writes.length, 1)
  assert.equal(cart.cart.id_carrito, 2)
})

test('actual login and logout actions hide cart throughout pending transitions and exclude ADMIN', async t => {
  const login = deferred()
  const logout = deferred()
  const { auth, cart, reads, http } = runtime(t)
  http.post = url => url === '/auth/login' ? login.promise : logout.promise
  const loggingIn = auth.login('customer@example.test', 'password')
  assert.equal(await cart.cargarCarrito(), false)
  assert.equal(reads.length, 0)
  login.resolve({ data: { user: user(1) } })
  await loggingIn
  await tick()
  assert.equal(cart.cart.id_carrito, 1)
  const loggingOut = auth.logout()
  assert.equal(cart.cart, null)
  assert.equal(await cart.cargarCarrito(), false)
  logout.resolve({})
  await loggingOut
  auth.user = user(3, 'ADMIN')
  await tick()
  assert.equal(reads.length, 1)
  assert.equal(cart.cart, null)
  auth.user = user(1)
  await tick()
  assert.equal(reads.length, 2)
  auth.user = user(3, 'ADMIN')
  assert.equal(cart.cart, null)
  assert.equal(await cart.cargarCarrito(), false)
})

test('blocks private reads during overlapping session checks, then restores the verified cart', async t => {
  const a = deferred()
  const b = deferred()
  const { auth, cart, reads, http } = runtime(t, { restore: user(1) })
  await tick()
  let checks = 0
  http.get = () => ++checks === 1 ? a.promise : b.promise
  const first = auth.fetchSession()
  const second = auth.fetchSession()
  assert.equal(cart.cart, null)
  assert.equal(await cart.cargarCarrito(), false)
  a.resolve({ data: { user: user(1) } })
  await first
  await tick()
  assert.equal(reads.length, 1)
  b.resolve({ data: { user: user(1) } })
  await second
  await tick()
  assert.equal(reads.length, 2)
  assert.equal(cart.cart.id_carrito, 1)
})

test('manual clearing cancels queued recovery and active reconciliation', async t => {
  const result = deferred()
  const { cart, reads } = runtime(t, { restore: user(1), read: () => result.promise })
  cart.limpiarEstado()
  await tick()
  assert.equal(reads.length, 0)
  const load = cart.cargarCarrito()
  cart.limpiarEstado()
  assert.equal(reads[0].aborted, true)
  result.resolve(snapshot())
  assert.equal(await load, false)
  assert.equal(cart.cart, null)
})
