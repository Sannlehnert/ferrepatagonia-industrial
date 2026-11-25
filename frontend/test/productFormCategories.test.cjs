const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { parse, compileScript } = require('@vue/compiler-sfc')
const ts = require('typescript')
const { createSSRApp, createRenderer, h, reactive, nextTick } = require('vue')
const { renderToString } = require('@vue/server-renderer')

const renderer = createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
})

const settle = async () => {
  for (let index = 0; index < 6; index++) {
    await new Promise(resolve => setImmediate(resolve))
    await nextTick()
  }
}

const filename = resolve(__dirname, '../src/views/admin/ProductFormModal.vue')
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })

function loadComponent(inlineTemplate) {
  const script = compileScript(descriptor, {
    id: inlineTemplate ? 'product-form-test' : 'product-form-mount-test',
    inlineTemplate,
  })
  const code = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '../../services/adminProductService') return { saveAdminProduct() {} }
    if (name === '@/components/ProductThumbnail.vue') return { default: {} }
    if (name === '../../services/adminMutationError') return require('../src/services/adminMutationError.ts')
    if (name === '@/types/pricing') return require('../src/types/pricing.ts')
    return require(name)
  }, compiled, compiled.exports)
  return compiled.exports
}

const compiled = { exports: loadComponent(true) }
const mountable = loadComponent(false).default

test('editar muestra la evidencia actual del precio base y crear no', async () => {
  const render = product => renderToString(createSSRApp(compiled.exports.default, { isOpen: true, product, categories: [] }))
  const sintetico = await render({ id_producto: 1, id_categoria: 7, activo: 1, precio: 10, estado_precio_base: 'SINTETICO' })
  assert.match(sintetico, /Importe base cargado \(USD\)/)
  assert.match(sintetico, /Precio base simulado · No es evidencia real/)
  assert.match(sintetico, /invalida la evidencia previa/)
  const pendiente = await render({ id_producto: 1, id_categoria: 7, activo: 1, precio: 10, estado_precio_base: 'NO_VERIFICADO' })
  assert.match(pendiente, /Precio pendiente de verificación/)
  assert.doesNotMatch(await render(null), /estado-precio-base/)
})

test('error y reintento de categorías siguen visibles junto a la categoría actual', async () => {
  const html = await renderToString(createSSRApp(compiled.exports.default, {
    isOpen: true,
    product: { id_producto: 1, id_categoria: 7, categoria_nombre: 'Herramientas', activo: 1 },
    categories: [],
    categoriesError: 'No se pudieron cargar las categorías.',
  }))
  assert.match(html, /role="alert"/)
  assert.match(html, /No se pudieron cargar las categorías\./)
  assert.match(html, /Reintentar/)
  assert.match(html, /<option value="7">/)
  assert.match(html, /Herramientas \(Actual\)/)
})

test('crear sin categorías muestra error y reintento sin habilitar el selector', async () => {
  const html = await renderToString(createSSRApp(compiled.exports.default, {
    isOpen: true, product: null, categories: [], categoriesError: 'Error de categorías',
  }))
  assert.match(html, /Error de categorías/)
  assert.match(html, /Reintentar/)
  assert.match(html, /<select[^>]*disabled/)
})

async function mountProduct(initialProps) {
  const component = { ...mountable, render: () => null }
  const props = reactive({
    isOpen: true,
    product: null,
    categories: [],
    ...initialProps,
  })
  const host = { setup: () => () => h(component, props) }
  const app = renderer.createApp(host)
  app.mount({})
  await settle()

  return {
    props,
    state: app._instance.subTree.component.setupState,
    unmount: () => app.unmount(),
  }
}

test('alta sin categorías no asume la categoría 1 y adopta la primera válida tardía sin marcarse sucia', async t => {
  const { props, state, unmount } = await mountProduct({})
  t.after(unmount)

  assert.equal(state.form.id_categoria, '')
  assert.equal(state.isDirty, false)

  props.categories = [
    { id_categoria: 0, nombre: 'Inválida' },
    { id_categoria: 5, nombre: 'Herramientas' },
  ]
  await settle()

  assert.equal(state.form.id_categoria, 5)
  assert.equal(state.isDirty, false)

  props.categories = [{ id_categoria: 9, nombre: 'Otra' }]
  await settle()
  assert.equal(state.form.id_categoria, 5)
})

test('la categoría tardía no pisa una selección manual ni la de edición', async t => {
  const create = await mountProduct({})
  t.after(create.unmount)
  create.state.form.id_categoria = 3
  assert.equal(create.state.isDirty, true)

  create.props.categories = [{ id_categoria: 8, nombre: 'Tardía' }]
  await settle()
  assert.equal(create.state.form.id_categoria, 3)

  const edit = await mountProduct({
    product: { id_producto: 2, id_categoria: 7, nombre: 'Taladro', codigo: 'T-2' },
  })
  t.after(edit.unmount)
  assert.equal(edit.state.form.id_categoria, 7)

  edit.props.categories = [{ id_categoria: 4, nombre: 'Distinta' }]
  await settle()
  assert.equal(edit.state.form.id_categoria, 7)
  assert.equal(edit.state.isDirty, false)
})

test('el aviso de cierre se limpia al descartar errores y revertir los cambios', async t => {
  const { state, unmount } = await mountProduct({
    product: { id_producto: 2, id_categoria: 7, nombre: 'Original', codigo: 'T-2' },
  })
  t.after(unmount)

  state.form.nombre = 'Borrador'
  state.requestClose('implicit')
  assert.match(state.closeAttemptNotice, /no se pierden/)

  state.form.nombre = 'Original'
  await settle()
  assert.equal(state.closeAttemptNotice, '')

  state.backendError = 'Error pendiente'
  state.requestClose('implicit')
  assert.match(state.closeAttemptNotice, /no se pierden/)

  state.backendError = ''
  await settle()
  assert.equal(state.closeAttemptNotice, '')
})
