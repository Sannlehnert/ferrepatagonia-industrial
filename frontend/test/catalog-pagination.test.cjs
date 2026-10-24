const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { parse, compileScript } = require('@vue/compiler-sfc')
const ts = require('typescript')
const vue = require('vue')
const { createRouter, createMemoryHistory } = require('vue-router')

// Exercise the real SFC setup and Vue Router without adding a DOM/test dependency.
const filename = resolve(__dirname, '../src/views/CatalogoView.vue')
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'catalog-pagination-test' })
const code = ts.transpileModule(script.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
})
const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve))
    await vue.nextTick()
  }
}
const response = (page, totalPages = 3) => ({
  productos: [],
  pagination: { page, totalPages, total: totalPages * 12, limit: 12,
    hasPrevious: page > 1, hasNext: page < totalPages },
})

async function mount(t, page, handler = query => response(query.page)) {
  const requests = []
  const service = {
    getCatalog(query, signal) {
      requests.push({ ...query })
      return handler(query, signal)
    },
    getCatalogCategories: async () => [{ id: 5, nombre: 'Herramientas' }],
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/services/catalogService') return service
    if (name === '@/components/CatalogFilters.vue') return { default: {} }
    if (name === '@/utils/catalogPagination') return require('../src/utils/catalogPagination.ts')
    return require(name)
  }, module, module.exports)
  const component = module.exports.default
  component.render = () => null
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/catalogo', name: 'catalogo', component },
  ] })
  await router.push({ name: 'catalogo', query: {
    categoria: '5', busqueda: 'tornillo', extra: 'conservar',
    ...(page === undefined ? {} : { page }),
  } })
  const app = renderer.createApp(component)
  app.use(router)
  app.mount({})
  t.after(() => app.unmount())
  await settle()
  return { router, requests, state: app._instance.setupState }
}

for (const page of ['0', '-1', '1.5', 'abc', '1000001', '1e3', '1e6',
  '9007199254740993', '99999999999999999999999999999999', ['2', '3'], ['2', '2'], '', null,
  ' 2 ', '+2', '02', '1']) {
  test(`invalid/noncanonical page ${JSON.stringify(page)} recovers before request`, async t => {
    const { router, requests, state } = await mount(t, page)
    assert.deepEqual(requests, [{ page: 1, limit: 12, categoria: 5, busqueda: 'tornillo' }])
    assert.deepEqual(router.currentRoute.value.query, {
      categoria: '5', busqueda: 'tornillo', extra: 'conservar',
    })
    assert.equal(state.cargando, false)
    assert.equal(state.error, null)
  })
}

for (const page of ['999', '1000000']) {
  test(`valid page ${page} recovers to last result page preserving filters`, async t => {
    const { router, requests, state } = await mount(t, page)
    assert.deepEqual(requests.map(q => q.page), [Number(page), 3])
    assert.ok(requests.every(q => q.categoria === 5 && q.busqueda === 'tornillo'))
    assert.equal(router.currentRoute.value.query.page, '3')
    assert.equal(router.currentRoute.value.query.extra, 'conservar')
    assert.equal(state.cargando, false)
  })
}

test('maximum page is accepted when available', async t => {
  const { requests, state } = await mount(t, '1000000', q => response(q.page, 1000000))
  assert.deepEqual(requests.map(q => q.page), [1000000])
  assert.equal(state.pagination.page, 1000000)
})

test('zero totalPages recovers to page 1 without a loop', async t => {
  const { router, requests, state } = await mount(t, '999', q => response(q.page, 0))
  assert.deepEqual(requests.map(q => q.page), [999, 1])
  assert.equal(router.currentRoute.value.query.page, undefined)
  assert.equal(router.currentRoute.value.query.categoria, '5')
  assert.equal(router.currentRoute.value.query.busqueda, 'tornillo')
  assert.equal(state.pagination.totalPages, 0)
  assert.equal(state.cargando, false)
})

test('normalization replaces history; page buttons push; back/forward and filters survive', async t => {
  const { router, requests, state } = await mount(t, undefined)
  global.window = { scrollTo() {} }
  t.after(() => { delete global.window })
  state.cambiarPagina(2)
  await settle()
  await router.push({ query: { ...router.currentRoute.value.query, page: '1000001' } })
  await settle()
  assert.equal(router.currentRoute.value.query.page, undefined)
  router.back()
  await settle()
  assert.equal(router.currentRoute.value.query.page, '2')
  router.forward()
  await settle()
  assert.equal(router.currentRoute.value.query.page, undefined)
  // Same effective page still needs canonicalization on subsequent navigation.
  await router.push({ query: { ...router.currentRoute.value.query, page: 'abc' } })
  await settle()
  assert.equal(router.currentRoute.value.query.page, undefined)
  await state.aplicarFiltros({ search: 'tuerca', categoryId: 6 })
  await settle()
  assert.deepEqual(requests.at(-1), { page: 1, limit: 12, categoria: 6, busqueda: 'tuerca' })
  await state.aplicarFiltros({ search: '', categoryId: null })
  await settle()
  assert.equal(router.currentRoute.value.query.categoria, undefined)
  assert.equal(router.currentRoute.value.query.busqueda, undefined)
  assert.equal(router.currentRoute.value.query.extra, 'conservar')
})

test('loading, error and retry after invalid page recovery', async t => {
  let finish
  let attempts = 0
  const { requests, state } = await mount(t, '1000001', q => {
    if (++attempts === 1) return new Promise((resolve, reject) => { finish = reject })
    return response(q.page)
  })
  assert.equal(state.cargando, true)
  finish(new Error('offline'))
  await settle()
  assert.equal(state.cargando, false)
  assert.equal(state.error, 'No se pudo cargar el catálogo.')
  await state.cargar()
  await settle()
  assert.equal(state.error, null)
  assert.equal(state.cargando, false)
  assert.deepEqual(requests.map(q => q.page), [1, 1])
  assert.equal(state.listaCategorias.length, 1)
})

test('stale request cannot overwrite recovered page or error state', async t => {
  let rejectOld
  const { router, state } = await mount(t, '2', q => q.page === 2
    ? new Promise((resolve, reject) => { rejectOld = reject }) : response(q.page))
  await router.push({ query: { ...router.currentRoute.value.query, page: 'abc' } })
  await settle()
  rejectOld(new Error('late failure'))
  await settle()
  assert.equal(state.pagination.page, 1)
  assert.equal(state.error, null)
  assert.equal(state.cargando, false)
})
