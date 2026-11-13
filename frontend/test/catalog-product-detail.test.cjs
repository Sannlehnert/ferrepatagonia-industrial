const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../src')
function service(get) {
  const calls = []
  const api = { get: async (...args) => { calls.push(args); return get(...args) } }
  const source = fs.readFileSync(path.join(root, 'services/catalogService.ts'), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/services/api') return { __esModule: true, default: api }
    return require(name)
  }, mod, mod.exports)
  return { service: mod.exports, calls }
}

const product = {
  id: 7, nombre: 'Taladro', codigo: 'T-7', descripcion: 'Percutor', imagen: null,
  stock: 4, categoria: { id: 2, nombre: 'Herramientas' }, precio: null,
  estadoPrecio: 'PENDIENTE_DEFINICION', disponible: true,
}

test('detalle consulta API pública por ID y valida el contrato autoritativo', async () => {
  const request = service(async () => ({ data: { data: { producto: product } } }))
  const signal = new AbortController().signal
  assert.deepEqual(await request.service.getCatalogProduct(7, signal), product)
  assert.equal(request.calls[0][0], '/catalogo/7')
  assert.equal(request.calls[0][1].signal, signal)
})

test('detalle no consulta IDs inválidos ni acepta importes del navegador', async () => {
  const request = service(async () => ({ data: { data: { producto: { ...product, precio: '1.00' } } } }))
  for (const id of [0, -1, 1.5, 2147483648, Number.NaN]) {
    await assert.rejects(request.service.getCatalogProduct(id), /Identificador/)
  }
  assert.equal(request.calls.length, 0)
  await assert.rejects(request.service.getCatalogProduct(7), /respuesta del detalle/)
})

test('detalle rechaza un contrato con stock/disponibilidad incoherentes', async () => {
  const request = service(async () => ({ data: { data: { producto: { ...product, disponible: false } } } }))
  await assert.rejects(request.service.getCatalogProduct(7), /respuesta del detalle/)
})
