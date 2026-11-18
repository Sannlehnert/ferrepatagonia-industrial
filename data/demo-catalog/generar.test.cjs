const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { categoriasRequeridas, columnas, csv, familias, generar } = require('./generar.cjs');
const {
  auditarCobertura, leerFuentes, validarAsociacion, validarContenidoIlustrativo,
} = require('./cobertura-visual.cjs');
const { leerCatalogoMaestro, seleccionarFuentesCatalogo } = require('./asociar-fotos.cjs');
const {
  archivoIlustrativoDeSku, bytesDe, claves, svg, validarLeyenda,
} = require('./ilustraciones.cjs');

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

test('el inventario visual reconcilia los 904 SKU con el registro de fotos y los pendientes', () => {
  const fuentes = leerFuentes();
  assert.ok(fuentes.size >= 31);
  const reporte = auditarCobertura(fuentes);
  const pendientes = reporte.grupos.flatMap(grupo => grupo.pendientes);
  assert.equal(new Set(pendientes).size, reporte.skuPendientes);
  assert.equal(pendientes.length + fuentes.size, 904);
  assert.deepEqual(reporte, require('./visual-audit.json'));
});

test('el informe de catálogo concilia imágenes, fuentes y pendientes', () => {
  const informe = require('./catalog-validation.json');
  const fuentes = leerFuentes();
  const auditoria = auditarCobertura(fuentes);
  assert.equal(informe.imagenes.length, informe.conImagenVerificada);
  assert.equal(informe.conImagenVerificada, fuentes.size);
  assert.deepEqual(informe.imagenes.map(i => i.sku).sort(), [...fuentes.keys()].sort());
  assert.equal(informe.pendientesDeImagen, auditoria.skuPendientes);
  assert.equal(informe.archivosFotograficos, auditoria.archivos);
  assert.equal(informe.gruposPendientes, auditoria.grupos.length);
});

test('cada ilustración de origen es generada con leyenda textual verificable', async () => {
  const fuentes = leerFuentes();
  const archivos = new Map([...fuentes.values()]
    .filter(fuente => fuente.archivo.startsWith('ilustrativa-'))
    .map(fuente => [fuente.archivo, fuente]));
  const creditos = new Set(readFileSync(join(__dirname, '../../frontend/public/demo-catalog/creditos.txt'), 'utf8').split(/\r?\n/));
  for (const [archivo, fuente] of archivos) {
    const clave = archivo.slice('ilustrativa-'.length, -'.webp'.length).toUpperCase();
    validarLeyenda(svg(clave));
    assert.deepEqual(fuente.bytes, await bytesDe(clave), archivo);
    validarContenidoIlustrativo(archivo, fuente.bytes);
    assert.ok(creditos.has(archivo), `Falta acreditar ${archivo}`);
  }
  assert.throws(() => validarLeyenda(svg('ABR').replace('IMAGEN ILUSTRATIVA', '')), /IMAGEN ILUSTRATIVA/);
  assert.throws(() => validarContenidoIlustrativo('ilustrativa-abr.webp', Buffer.from('WebP sin leyenda')),
    /versión con leyenda/);
  assert.equal(archivos.size, 26);
  assert.equal(claves.length, 27);
});

test('rechaza asociaciones renombradas, familias incorrectas y fotografías de otra medida', () => {
  const fuentes = leerFuentes();
  const disco125 = fuentes.get('FP-DEMO-ABR-DISCO-METAL-125-MM');
  const cono30 = fuentes.get('FP-DEMO-CON-CONO-NARANJA-30-CM');
  assert.throws(() => validarAsociacion(disco125.sku, 'fotografia-renombrada.webp'), /Archivo renombrado/);
  assert.throws(() => validarAsociacion('FP-DEMO-FIJ-ABRAZADERA-12-MM', 'ilustrativa-cas.webp'),
    /Ilustración incompatible/);
  assert.throws(() => validarAsociacion('FP-DEMO-CON-CONO-NARANJA-18-CM', cono30.archivo),
    /Archivo renombrado|Ilustración incompatible/);
  assert.throws(() => validarAsociacion(cono30.sku, 'ilustrativa-con.webp'), /Archivo renombrado/);
  assert.equal(archivoIlustrativoDeSku('FP-DEMO-CON-CONO-NARANJA-18-CM'), 'ilustrativa-con.webp');
});

test('prepara la asociación al catálogo maestro de 100 SKU sin exigir los SKU ausentes', () => {
  const fuentes = leerFuentes();
  const catalogo = leerCatalogoMaestro();
  const seleccion = seleccionarFuentesCatalogo(fuentes, catalogo);
  assert.equal(seleccion.total, 100);
  assert.equal(seleccion.fuentes.size, 61);
  assert.equal(seleccion.pendientes.length, 39);
  for (const [sku, fuente] of seleccion.fuentes) {
    assert.equal(fuente.nombre, catalogo.find(fila => fila.sku === sku).nombre_propuesto);
  }
});

test('el generador exige nombres de categoría inequívocos', () => {
  const [primera] = categoriasRequeridas;
  assert.throws(() => generar(categorias.filter(c => c.nombre !== primera)), /categoría activa/);
  assert.throws(() => generar([...categorias, categorias.find(c => c.nombre === primera)]), /nombre único/);
  const destino = { id: 999, nombre: 'Herramientas y accesorios' };
  assert.equal(generar([...categorias, destino], undefined, { [primera]: destino.nombre })[0].id_categoria, destino.id);
});
