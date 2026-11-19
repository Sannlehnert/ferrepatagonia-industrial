const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { categoriasRequeridas, columnas, csv, familias, generar } = require('./generar.cjs');
const {
  auditarCobertura, leerFuentes, validarAsociacion, validarContenidoIlustrativo, validarFuente, leerRegistroCredito,
} = require('./cobertura-visual.cjs');
const { asociarFotos, leerCatalogoMaestro, seleccionarFuentesCatalogo } = require('./asociar-fotos.cjs');
const {
  archivoIlustrativoDeSku, claves, svg, validarLeyenda,
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

test('cada ilustración de origen es generada con leyenda textual verificable', () => {
  const fuentes = leerFuentes();
  const archivos = new Map([...fuentes.values()]
    .filter(fuente => fuente.archivo.startsWith('ilustrativa-'))
    .map(fuente => [fuente.archivo, fuente]));
  const creditos = new Set(readFileSync(join(__dirname, '../../frontend/public/demo-catalog/creditos.txt'), 'utf8').split(/\r?\n/));
  for (const [archivo, fuente] of archivos) {
    const clave = archivo.slice('ilustrativa-'.length, -'.webp'.length).toUpperCase();
    validarLeyenda(svg(clave));
    validarContenidoIlustrativo(archivo, fuente.bytes);
    assert.ok(creditos.has(archivo), `Falta acreditar ${archivo}`);
  }
  assert.throws(() => validarLeyenda(svg('ABR').replace('IMAGEN ILUSTRATIVA', '')), /IMAGEN ILUSTRATIVA/);
  assert.throws(() => validarContenidoIlustrativo('ilustrativa-abr.webp', Buffer.from('WebP sin leyenda')),
    /versión con leyenda/);
  assert.equal(archivos.size, 38);
  assert.equal(claves.length, 42);
});

test('rechaza huellas, autoría, licencias, fuentes y familias inconsistentes', () => {
  const fuente = leerFuentes().get('FP-DEMO-CON-CONO-NARANJA-30-CM');
  const informe = require('./catalog-validation.json').imagenes.find(i => i.sku === fuente.sku);
  for (const campo of ['autor', 'licencia', 'fuente', 'url_original', 'referencia_licencia']) {
    assert.throws(() => validarFuente({ ...fuente, [campo]: 'https://example.invalid/evidencia-falsa' }, fuente.bytes), /Créditos/);
  }
  assert.throws(() => validarFuente({ ...fuente, familia: 'Guantes de trabajo' }, fuente.bytes), /Familia incorrecta/);
  assert.throws(() => validarFuente(fuente, fuente.bytes, { ...informe, sha256Origen: '0'.repeat(64) }), /Hash del informe/);
  assert.throws(() => validarFuente(fuente, Buffer.from('foto alterada')), /Hash del informe/);
  for (const sku of ['FP-DEMO-FIJ-TARUGO-NYLON-10-MM', 'FP-DEMO-CAS-CASCO-ALA-AMARILLO']) {
    assert.throws(() => validarAsociacion(sku, sku.includes('TARUGO') ? 'tarugo-nailon.webp' : 'casco-ala-completa-amarillo.webp'), /Ilustración incompatible/);
  }
});

test('rechaza recortar CC BY-SA 4.0 a CC BY aunque sea un prefijo del crédito', () => {
  const fuente = leerFuentes().get('FP-DEMO-ELE-CALADORA-500-W');
  assert.equal(fuente.licencia, 'CC BY-SA 4.0');
  assert.doesNotThrow(() => validarFuente(fuente, fuente.bytes));
  assert.throws(() => validarFuente({ ...fuente, licencia: 'CC BY' }, fuente.bytes), /inconsistentes.*: licencia/);
});

test('rechaza sustituir la ficha de Wikimedia por el dominio de Commons', () => {
  const fuente = leerFuentes().get('FP-DEMO-ELE-CALADORA-500-W');
  assert.equal(fuente.fuente, 'https://commons.wikimedia.org/wiki/File:Ryobi_RJS_720_-_2017-01-19_(8).jpg');
  assert.doesNotThrow(() => validarFuente(fuente, fuente.bytes));
  assert.throws(() => validarFuente({ ...fuente, fuente: 'https://commons.wikimedia.org/' }, fuente.bytes),
    /inconsistentes.*: fuente/);
});

test('rechaza sustituir la URL de licencia por el dominio de Creative Commons', () => {
  const fuente = leerFuentes().get('FP-DEMO-ELE-CALADORA-500-W');
  assert.equal(fuente.referencia_licencia, 'https://creativecommons.org/licenses/by-sa/4.0');
  assert.doesNotThrow(() => validarFuente(fuente, fuente.bytes));
  assert.throws(() => validarFuente({ ...fuente, referencia_licencia: 'https://creativecommons.org/' }, fuente.bytes),
    /inconsistentes.*: referencia_licencia/);
});

test('exige un único registro completo por archivo usado, sin restringir créditos históricos ajenos', () => {
  const archivo = 'caladora-500w.webp';
  const bloques = readFileSync(join(__dirname, '../../frontend/public/demo-catalog/creditos.txt'), 'utf8')
    .split(/\r?\n\s*\r?\n/);
  const bloque = bloques.find(texto => texto.split(/\r?\n/)[0] === archivo);
  const registro = bloque.split(/\r?\n/).find(linea => linea.startsWith('Registro: '));
  const valores = registro.slice('Registro: '.length).split(' · ');
  const fuente = leerFuentes().get('FP-DEMO-ELE-CALADORA-500-W');
  const campos = ['autor', 'fuente', 'url_original', 'licencia', 'referencia_licencia'];
  assert.deepEqual(leerRegistroCredito(archivo, bloque), Object.fromEntries(campos.map(campo => [campo, fuente[campo]])));
  assert.deepEqual(leerRegistroCredito(archivo, `${bloque}\n\nhistorico-sin-uso.webp\nFormato anterior sin Registro`),
    leerRegistroCredito(archivo, bloque));
  assert.throws(() => leerRegistroCredito(archivo, `${bloque}\n\n${bloque}`), /Créditos ausentes o duplicados/);
  assert.throws(() => leerRegistroCredito(archivo, `${bloque}\n${registro}`), /Registro ausente o duplicado/);
  assert.throws(() => leerRegistroCredito(archivo, bloque.replace(registro, '')), /Registro ausente o duplicado/);
  assert.throws(() => leerRegistroCredito(archivo, bloque.replace(archivo, `otro-${archivo}`)), /Créditos ausentes/);
  assert.throws(() => leerRegistroCredito(archivo, bloque.replace(registro, ` ${registro}`)), /Registro ambiguo/);
  assert.throws(() => leerRegistroCredito(archivo, bloque.replace(registro, `${registro} · extra`)), /Registro incompleto o ambiguo/);
  for (let indice = 0; indice < campos.length; indice++) {
    const incompleto = valores.map((valor, i) => i === indice ? '' : valor);
    assert.throws(() => leerRegistroCredito(archivo, bloque.replace(registro, `Registro: ${incompleto.join(' · ')}`)),
      /Registro incompleto o ambiguo/);
  }
});

test('todos los activos asociados se decodifican y respetan el máximo de 960 px', async () => {
  const sharp = require('../../backend/node_modules/sharp');
  const archivos = new Map([...leerFuentes().values()].map(f => [f.archivo, f.bytes]));
  for (const [archivo, bytes] of archivos) {
    const { info } = await sharp(bytes, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true });
    assert.ok(info.width > 0 && info.height > 0 && Math.max(info.width, info.height) <= 960, archivo);
    const normalizado = await sharp(bytes).rotate().webp({ quality: 85 }).toBuffer();
    const huella = require('node:crypto').createHash('sha256').update(normalizado).digest('hex');
    for (const imagen of require('./catalog-validation.json').imagenes.filter(i => i.archivo === archivo)) {
      assert.equal(imagen.sha256Publicado, huella, `Hash publicado incorrecto: ${imagen.sku}`);
    }
  }
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

test('los primeros 50 SKU están cubiertos y la matriz publicada identifica cada tipo y archivo', () => {
  const fuentes = leerFuentes();
  const maestro = leerCatalogoMaestro().slice(0, 50);
  const { data: matriz, errors } = require('../../backend/node_modules/papaparse').parse(
    readFileSync(join(__dirname, '../../docs/310/matriz-verificada.csv'), 'utf8'), { header: true, skipEmptyLines: true });
  assert.deepEqual(errors, []);
  assert.equal(matriz.length, 50);
  for (const [i, producto] of maestro.entries()) {
    const fuente = fuentes.get(producto.sku);
    assert.ok(fuente, `Falta imagen del alcance #310: ${producto.sku}`);
    assert.equal(matriz[i].sku, producto.sku);
    assert.equal(matriz[i].nombre, producto.nombre_propuesto);
    assert.equal(matriz[i].familia, producto.familia);
    assert.equal(matriz[i].archivo, fuente.archivo);
    assert.equal(matriz[i].tipo, fuente.archivo.startsWith('ilustrativa-') ? 'Ilustración' : 'Fotografía');
  }
  assert.equal(matriz.filter(fila => fila.tipo === 'Fotografía').length, 9);
});

test('conservar una imagen existente no la declara verificada ni identifica su archivo con el plan nuevo', async () => {
  const fuente = leerFuentes().get('FP-DEMO-FIJ-TARUGO-NYLON-10-MM');
  const producto = { id_producto: 1, codigo: fuente.sku, nombre: fuente.nombre, imagen: '/api/product-images/anterior.webp' };
  const resultado = await asociarFotos({ get: async ruta => ruta.endsWith('/1') ? producto : [producto],
    subir: () => assert.fail('No reemplazar una imagen preexistente automáticamente') },
  { aplicar: true, fuentes: new Map([[fuente.sku, fuente]]) });
  assert.deepEqual(resultado, [{ sku: fuente.sku, archivoPlanificado: fuente.archivo,
    estado: 'conservada', imagen: producto.imagen, verificacionPendiente: true }]);
});

test('el generador exige nombres de categoría inequívocos', () => {
  const [primera] = categoriasRequeridas;
  assert.throws(() => generar(categorias.filter(c => c.nombre !== primera)), /categoría activa/);
  assert.throws(() => generar([...categorias, categorias.find(c => c.nombre === primera)]), /nombre único/);
  const destino = { id: 999, nombre: 'Herramientas y accesorios' };
  assert.equal(generar([...categorias, destino], undefined, { [primera]: destino.nombre })[0].id_categoria, destino.id);
});
