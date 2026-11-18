const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('../../backend/node_modules/papaparse')
const ts = require('typescript')
const { test } = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '../src/utils/illustrativeDemoImage.ts'), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', code)(mod, mod.exports)
const { isIllustrativeDemoImage } = mod.exports

test('recognizes every illustrative SKU after its uploaded filename is replaced', () => {
  const { data: sources, errors } = parse(
    fs.readFileSync(path.join(__dirname, '../../data/demo-catalog/image-sources.csv'), 'utf8'),
    { header: true, skipEmptyLines: true },
  )
  assert.deepEqual(errors, [])
  for (const source of sources) {
    const illustrative = source.ruta_final.includes('/ilustrativa-')
    assert.equal(
      isIllustrativeDemoImage(source.sku, '/api/product-images/00000000-0000-4000-8000-000000000000.webp'),
      illustrative,
      source.sku,
    )
  }
})

test('recognizes illustrative asset paths and leaves photographs unmarked', () => {
  assert.equal(isIllustrativeDemoImage('SKU-OTHER', '/demo-catalog/ilustrativa-abr-hoja.webp'), true)
  assert.equal(isIllustrativeDemoImage('SKU-OTHER', '/api/product-images/00000000-0000-4000-8000-000000000000.webp'), false)
  assert.equal(isIllustrativeDemoImage('FP-DEMO-CON-CONO-NARANJA-30-CM', '/api/product-images/id.webp'), false)
})
