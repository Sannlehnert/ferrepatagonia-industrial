const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { parse, compileScript } = require('@vue/compiler-sfc')
const ts = require('typescript')
const { createSSRApp } = require('vue')
const { renderToString } = require('@vue/server-renderer')

const filename = resolve(__dirname, '../src/views/admin/ProductFormModal.vue')
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'product-form-test', inlineTemplate: true })
const code = ts.transpileModule(script.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const compiled = { exports: {} }
new Function('require', 'module', 'exports', code)(name => {
  if (name === '../../services/adminProductService') return { saveAdminProduct() {} }
  return require(name)
}, compiled, compiled.exports)

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
