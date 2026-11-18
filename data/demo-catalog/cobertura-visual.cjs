const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parse } = require('../../backend/node_modules/papaparse');
const { archivoIlustrativoDeSku, variantesPorSku } = require('./ilustraciones.cjs');
const familias = require('./variantes.cjs');

const archivoFotos = join(__dirname, 'image-sources.csv');
const directorioFotos = join(__dirname, '../../frontend/public/demo-catalog');
const rutaWebp = /^\/demo-catalog\/([a-z0-9-]+\.webp)$/;
const manifiestoIlustraciones = JSON.parse(readFileSync(join(directorioFotos, 'ilustraciones-manifest.json'), 'utf8'));
const informeCatalogo = JSON.parse(readFileSync(join(__dirname, 'catalog-validation.json'), 'utf8'));
const imagenReportadaPorSku = new Map(informeCatalogo.imagenes.map(imagen => [imagen.sku, imagen.archivo]));
const fotoPorSku = new Map([
  ['FP-DEMO-ABR-DISCO-METAL-125-MM', 'disco-corte-metal.webp'],
  ['FP-DEMO-CAS-CASCO-ALA-AMARILLO', 'casco-ala-completa-amarillo.webp'],
  ['FP-DEMO-CAS-CASCO-CORTO-AMARILLO', 'casco-visera-corta-amarillo.webp'],
  ['FP-DEMO-CON-CONO-NARANJA-30-CM', 'cono-naranja-30-cm.webp'],
]);
// Las ilustraciones genéricas no son fotos: se reutilizan en toda su familia y
// deben declararse como obra propia para que no se confundan con evidencia visual.
const ilustrativaPrefijo = 'ilustrativa-';

function leerCsv(path) {
  const { data, errors } = parse(readFileSync(path, 'utf8'), { header: true, skipEmptyLines: true });
  assert.deepEqual(errors, [], `CSV inválido: ${path}`);
  return data;
}

function validarAsociacion(sku, archivo) {
  const conoDeOtraMedida = sku.startsWith('FP-DEMO-CON-CONO-NARANJA-') &&
    sku !== 'FP-DEMO-CON-CONO-NARANJA-30-CM';
  const debeSerIlustrativa = conoDeOtraMedida || Object.prototype.hasOwnProperty.call(variantesPorSku, sku);
  if (debeSerIlustrativa || archivo.startsWith(ilustrativaPrefijo)) {
    assert.equal(archivo, archivoIlustrativoDeSku(sku), `Ilustración incompatible con el SKU ${sku}`);
  }
  assert.equal(archivo, imagenReportadaPorSku.get(sku), `Archivo renombrado o no verificado para ${sku}`);
  if (!archivo.startsWith(ilustrativaPrefijo) && fotoPorSku.has(sku)) {
    assert.equal(archivo, fotoPorSku.get(sku), `La medida de la foto no corresponde al SKU ${sku}`);
  }
}

function validarContenidoIlustrativo(archivo, bytes) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, manifiestoIlustraciones[archivo], `La ilustración ${archivo} no coincide con la versión con leyenda`);
}

function leerFuentes() {
  const productos = new Map(leerCsv(join(__dirname, 'productos-ferrepatagonia-demo.csv')).map(p => [p.codigo, p]));
  const fuentes = new Map();
  const archivos = new Map();
  for (const fila of leerCsv(archivoFotos)) {
    const producto = productos.get(fila.sku);
    assert.ok(producto && !fuentes.has(fila.sku), `SKU desconocido o duplicado: ${fila.sku}`);
    const archivo = rutaWebp.exec(fila.ruta_final)?.[1];
    assert.ok(archivo && fila.autor && fila.licencia && fila.modificaciones, `Falta evidencia visual para ${fila.sku}`);
    validarAsociacion(fila.sku, archivo);
    if (archivo.startsWith(ilustrativaPrefijo)) {
      assert.ok(fila.licencia.startsWith('Obra propia') && /no corresponde a la variante exacta/.test(fila.modificaciones),
        `La ilustración de ${fila.sku} debe declararse como obra propia y no exacta`);
    }
    for (const url of [fila.fuente, fila.url_original, fila.referencia_licencia]) {
      assert.equal(new URL(url).protocol, 'https:', `Enlace de procedencia inválido para ${fila.sku}`);
    }
    if (!archivos.has(archivo)) {
      const bytes = readFileSync(join(directorioFotos, archivo));
      assert.ok(bytes.length <= 5 * 1024 * 1024 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP', `El archivo ${archivo} debe ser WebP de hasta 5 MiB`);
      if (archivo.startsWith(ilustrativaPrefijo)) {
        validarContenidoIlustrativo(archivo, bytes);
      }
      archivos.set(archivo, bytes);
    }
    fuentes.set(fila.sku, { ...fila, nombre: producto.nombre, archivo, bytes: archivos.get(archivo) });
  }
  return fuentes;
}

// Los modelos con aspecto, leyenda, conteo o marcado visible variable exigen
// evidencia por variante. Un grupo de medidas solo propone una foto sin escala.
const separar = new Set([
  'MAN-limas', 'ELE-taladro', 'ELE-amoladora', 'ELE-caladora', 'ELE-lijadora',
  'NEU-manifold', 'CAS-casco-ala', 'CAS-casco-visera', 'CAS-casco-corto', 'CAS-casco-ranuras',
  'AUD-orejera', 'ALT-bolso-arnes', 'CON-poste', 'CIN-cinta-delimitar', 'CIN-cinta-piso',
  'SEN-cartel-pvc', 'SEN-cartel-aluminio', 'SEN-cartel-vinilo', 'SEN-cartel-acrilico',
  'MAT-bornera', 'ILU-reflector', 'ILU-lampara-e27', 'ADH-cola', 'ADH-contacto',
  'ABR-lija-madera', 'ABR-lija-agua', 'ABR-disco-metal', 'CON-cono',
]);

function auditarCobertura(fuentes = leerFuentes()) {
  const productos = leerCsv(join(__dirname, 'productos-ferrepatagonia-demo.csv'));
  const modelos = new Map(familias.flatMap(([familia, , nombreFamilia, entradas]) =>
    entradas.map(([clave, nombre]) => [nombre, { clave: `${familia}-${clave}`, nombreFamilia }])));
  const grupos = new Map();
  const grupoPorArchivo = new Map();
  for (const producto of productos) {
    const [nombre, variante] = producto.nombre.split(' · ');
    const nombreModelo = producto.codigo.startsWith('FP-DEMO-CON-CONO-NARANJA-')
      ? 'Cono de señalización naranja'
      : nombre;
    const modelo = modelos.get(nombreModelo);
    assert.ok(modelo || !variante, `Falta modelo para ${producto.codigo}`);
    const criterio = !modelo || separar.has(modelo.clave) ? variante :
      modelo.clave === 'ALT-arnes' ? variante.split(' ').at(-1) : undefined;
    const clave = [modelo?.clave ?? producto.codigo, criterio].filter(Boolean).join('/');
    if (!grupos.has(clave)) grupos.set(clave, {
      clave, modelo: nombreModelo, ...(criterio ? { criterioVisible: criterio } : {}),
      familia: modelo?.nombreFamilia ?? fuentes.get(producto.codigo)?.familia,
      pendientes: [], archivos: [],
    });
    const grupo = grupos.get(clave);
    const fuente = fuentes.get(producto.codigo);
    const ilustrativa = fuente?.archivo.startsWith('ilustrativa-');
    if (fuente && !ilustrativa && !grupo.archivos.includes(fuente.archivo)) {
      assert.ok(!grupoPorArchivo.has(fuente.archivo), `Foto ${fuente.archivo} reutilizada entre grupos no equivalentes`);
      grupoPorArchivo.set(fuente.archivo, clave);
      grupo.archivos.push(fuente.archivo);
    }
    if (!fuente) grupo.pendientes.push(producto.codigo);
  }
  const archivosDe = ilustrativas => new Set([...fuentes.values()]
    .filter(f => f.archivo.startsWith(ilustrativaPrefijo) === ilustrativas).map(f => f.archivo));
  const skuIlustrativos = [...fuentes.values()].filter(f => f.archivo.startsWith(ilustrativaPrefijo)).length;
  return {
    sku: productos.length, skuConFuente: fuentes.size, skuIlustrativos, skuPendientes: productos.length - fuentes.size,
    archivos: archivosDe(false).size, archivosIlustrativos: archivosDe(true).size,
    grupos: [...grupos.values()].filter(g => g.pendientes.length),
  };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(auditarCobertura(), null, 2)}\n`);

module.exports = {
  leerFuentes, auditarCobertura, validarAsociacion, validarContenidoIlustrativo,
};
