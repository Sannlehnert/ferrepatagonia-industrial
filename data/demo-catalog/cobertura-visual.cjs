const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parse } = require('../../backend/node_modules/papaparse');
const familias = require('./variantes.cjs');

const archivoFotos = join(__dirname, 'image-sources.csv');
const directorioFotos = join(__dirname, '../../frontend/public/demo-catalog');
const rutaWebp = /^\/demo-catalog\/([a-z0-9-]+\.webp)$/;

function leerCsv(path) {
  const { data, errors } = parse(readFileSync(path, 'utf8'), { header: true, skipEmptyLines: true });
  assert.deepEqual(errors, [], `CSV inválido: ${path}`);
  return data;
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
    for (const url of [fila.fuente, fila.url_original, fila.referencia_licencia]) {
      assert.equal(new URL(url).protocol, 'https:', `Enlace de procedencia inválido para ${fila.sku}`);
    }
    if (!archivos.has(archivo)) {
      const bytes = readFileSync(join(directorioFotos, archivo));
      assert.ok(bytes.length <= 5 * 1024 * 1024 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP', `El archivo ${archivo} debe ser WebP de hasta 5 MiB`);
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
  'ABR-lija-madera', 'ABR-lija-agua',
]);

function auditarCobertura(fuentes = leerFuentes()) {
  const productos = leerCsv(join(__dirname, 'productos-ferrepatagonia-demo.csv'));
  const modelos = new Map(familias.flatMap(([familia, , nombreFamilia, entradas]) =>
    entradas.map(([clave, nombre]) => [nombre, { clave: `${familia}-${clave}`, nombreFamilia }])));
  const grupos = new Map();
  const grupoPorArchivo = new Map();
  for (const producto of productos) {
    const [nombre, variante] = producto.nombre.split(' · ');
    const esCono30 = producto.codigo === 'FP-DEMO-CON-CONO-NARANJA-30-CM';
    const nombreModelo = esCono30 ? 'Cono de señalización naranja' : nombre;
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
    if (fuente && !grupo.archivos.includes(fuente.archivo)) {
      assert.ok(!grupoPorArchivo.has(fuente.archivo), `Foto ${fuente.archivo} reutilizada entre grupos no equivalentes`);
      grupoPorArchivo.set(fuente.archivo, clave);
      grupo.archivos.push(fuente.archivo);
    }
    if (!fuente) grupo.pendientes.push(producto.codigo);
  }
  return {
    sku: productos.length, skuConFuente: fuentes.size, skuPendientes: productos.length - fuentes.size,
    archivos: new Set([...fuentes.values()].map(f => f.archivo)).size,
    grupos: [...grupos.values()].filter(g => g.pendientes.length),
  };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(auditarCobertura(), null, 2)}\n`);

module.exports = { leerFuentes, auditarCobertura };
