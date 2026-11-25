const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { unzipSync, strFromU8 } = require('fflate')

function load(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(name => dependencies[name] ?? require(name), mod, mod.exports)
  return mod.exports
}

const getAdminProductPage = async () => { throw new Error('No debe consultarse en esta prueba.') }
const service = load('services/productExportService', {
  './adminProductService': { getAdminProductPage },
  fflate: { strToU8: require('fflate').strToU8, zipSync: require('fflate').zipSync },
})

const products = [
  {
    id_producto: 1, id_categoria: 3, categoria_nombre: 'Herramientas & Fijaciones',
    codigo: '000123', nombre: 'Martillo "especial" <pro>', descripcion: 'Línea 1\nLínea 2 =SUMA(1,2)',
    precio: '150.5', descuento_especial_pct: '10.00', precio_verificado: '150.50',
    estado_precio_base: 'VERIFICADO', stock: 7, imagen: 'https://example.test/foto.png', activo: 1,
  },
  {
    id_producto: 2, id_categoria: 4, categoria_nombre: 'Fijaciones',
    codigo: 'FP-002', nombre: 'Tornillo', descripcion: null, precio: 0,
    descuento_especial_pct: null, precio_verificado: null,
    estado_precio_base: 'BASE_CERO', stock: 0, imagen: null, activo: 0,
  },
  {
    id_producto: 3, id_categoria: 3, categoria_nombre: 'Herramientas',
    codigo: 'SIN-PRECIO', nombre: 'Producto sin precio', descripcion: '',
    precio: null, descuento_especial_pct: null, precio_verificado: null,
    estado_precio_base: 'SIN_PRECIO', stock: 2, imagen: null, activo: true,
  },
]

test('genera un XLSX con hoja importable y distingue precio cargado de verificación', () => {
  const bytes = service.buildProductsWorkbook(products)
  const files = unzipSync(bytes)
  for (const name of [
    '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
  ]) assert.ok(files[name], name)

  const productsXml = strFromU8(files['xl/worksheets/sheet1.xml'])
  const pricesXml = strFromU8(files['xl/worksheets/sheet2.xml'])
  assert.match(productsXml, /codigo/)
  assert.match(productsXml, /precio_base_usd/)
  assert.match(productsXml, /descuento_especial_pct/)
  assert.match(productsXml, /000123/)
  assert.match(productsXml, /Martillo &quot;especial&quot; &lt;pro&gt;/)
  assert.match(productsXml, /150\.50/)
  assert.match(productsXml, /<v>10\.00<\/v>/)
  assert.match(productsXml, /<v>0\.00<\/v>/)
  assert.match(productsXml, /Línea 1\nLínea 2 =SUMA\(1,2\)/)
  assert.match(productsXml, /https:\/\/example\.test\/foto\.png/)
  assert.match(productsXml, /<v>7<\/v>/)
  assert.doesNotMatch(productsXml, /<f>/)
  assert.equal((productsXml.match(/SIN-PRECIO/g) || []).length, 1)

  assert.match(pricesXml, /Estado de precios|estado_precio/)
  assert.match(pricesXml, /VERIFICADO/)
  assert.match(pricesXml, /BASE_CERO/)
  assert.match(pricesXml, /SIN_PRECIO/)
  assert.match(pricesXml, /Herramientas &amp; Fijaciones/)
  assert.match(pricesXml, /150\.50/)
  assert.match(files['xl/workbook.xml'] && strFromU8(files['xl/workbook.xml']), /name="Productos"/)
  assert.match(files['xl/workbook.xml'] && strFromU8(files['xl/workbook.xml']), /name="Estado de precios"/)
})

test('exporta el conjunto completo paginado y respeta la búsqueda activa', async () => {
  const calls = []
  const pages = {
    1: { data: [products[0]], page: 1, limit: 1, total: 3, totalPages: 3 },
    2: { data: [products[1]], page: 2, limit: 1, total: 3, totalPages: 3 },
    3: { data: [products[2]], page: 3, limit: 1, total: 3, totalPages: 3 },
  }
  const mocked = load('services/productExportService', {
    './adminProductService': {
      getAdminProductPage: async (page, search, signal) => {
        calls.push({ page, search, signal })
        return pages[page]
      },
    },
    fflate: { strToU8: require('fflate').strToU8, zipSync: require('fflate').zipSync },
  })
  const controller = new AbortController()
  const result = await mocked.collectAdminProductsForExport('martillo', controller.signal)
  assert.deepEqual(result.map(product => product.id_producto), [1, 2, 3])
  assert.deepEqual(calls.map(call => [call.page, call.search]), [[1, 'martillo'], [2, 'martillo'], [3, 'martillo']])
  assert.ok(calls.every(call => call.signal === controller.signal))
})

test('aborta si el catálogo cambia o la página repite productos', async () => {
  const changed = load('services/productExportService', {
    './adminProductService': {
      getAdminProductPage: async page => page === 1
        ? { data: [products[0]], page: 1, limit: 1, total: 2, totalPages: 2 }
        : { data: [products[1]], page: 2, limit: 1, total: 3, totalPages: 3 },
    },
    fflate: { strToU8: require('fflate').strToU8, zipSync: require('fflate').zipSync },
  })
  await assert.rejects(changed.collectAdminProductsForExport(''), /catálogo cambió/)

  const duplicated = load('services/productExportService', {
    './adminProductService': {
      getAdminProductPage: async page => page === 1
        ? { data: [products[0]], page: 1, limit: 1, total: 2, totalPages: 2 }
        : { data: [products[0]], page: 2, limit: 1, total: 2, totalPages: 2 },
    },
    fflate: { strToU8: require('fflate').strToU8, zipSync: require('fflate').zipSync },
  })
  await assert.rejects(duplicated.collectAdminProductsForExport(''), /repetidos/)
})

test('el nombre del archivo distingue exportación completa y filtrada', () => {
  assert.equal(service.productsExportFilename('', new Date('2026-11-24T12:00:00Z')), 'productos-2026-11-24.xlsx')
  assert.equal(service.productsExportFilename('martillo', new Date('2026-11-24T12:00:00Z')), 'productos-filtrados-2026-11-24.xlsx')
})
