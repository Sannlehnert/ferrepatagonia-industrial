const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { parse } = require('../../backend/node_modules/papaparse');
const { categoriasRequeridas, columnas, csv, familias, generar } = require('./generar.cjs');

const { data: { categorias } } = require('./categorias-e2e.json');

test('el CSV versionado se regenera byte a byte con las categorías observadas', () => {
  const rows = generar(categorias);
  assert.equal(rows.length, 904);
  assert.equal(familias.length, 25);
  assert.equal(new Set(rows.map(row => row.id_categoria)).size, 8);
  assert.equal(new Set(rows.map(row => row.descripcion)).size, rows.length);
  assert.equal(csv(rows), readFileSync(join(__dirname, 'productos-ferrepatagonia-demo.csv'), 'utf8'));
  assert.deepEqual(Object.keys(rows[0]), columnas);
  for (const row of rows) {
    assert.match(row.codigo, /^FP-DEMO-[A-Z0-9-]{1,92}$/);
    assert.ok(row.nombre.length <= 200 && row.descripcion.length > 25);
    assert.ok(/^\d+\.\d{2}$/.test(row.precio_base_usd) && Number(row.precio_base_usd) > 0);
    assert.ok(Number.isInteger(row.stock) && row.stock > 0);
    assert.equal(row.activo, true);
  }
});

test('cada foto tiene un SKU existente, archivo local y atribución', () => {
  const skus = new Set(generar(categorias).map(row => row.codigo));
  const { data, errors } = parse(readFileSync(join(__dirname, 'image-sources.csv'), 'utf8'), { header: true, skipEmptyLines: true });
  assert.deepEqual(errors, []);
  assert.equal(new Set(data.map(row => row.sku)).size, data.length);
  assert.ok(data.length >= 4);
  for (const fuente of data) {
    assert.ok(skus.has(fuente.sku));
    assert.match(fuente.ruta_final, /^\/demo-catalog\/[a-z0-9-]+\.webp$/);
    assert.ok(existsSync(join(__dirname, '../../frontend/public', fuente.ruta_final)));
    assert.ok(fuente.autor && fuente.licencia && fuente.modificaciones);
    for (const enlace of [fuente.fuente, fuente.url_original, fuente.referencia_licencia]) {
      assert.equal(new URL(enlace).protocol, 'https:');
    }
  }
});

test('el generador exige nombres de categoría inequívocos', () => {
  const [primera] = categoriasRequeridas;
  assert.throws(() => generar(categorias.filter(c => c.nombre !== primera)), /categoría activa/);
  assert.throws(() => generar([...categorias, categorias.find(c => c.nombre === primera)]), /nombre único/);
  const destino = { id: 999, nombre: 'Herramientas y accesorios' };
  assert.equal(generar([...categorias, destino], undefined, { [primera]: destino.nombre })[0].id_categoria, destino.id);
});
