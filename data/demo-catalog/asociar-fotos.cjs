const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { parse } = require('../../backend/node_modules/papaparse');
const { leerFuentes } = require('./cobertura-visual.cjs');

const rutaAdministrada = /^\/api\/product-images\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.webp$/;
const productosAdmin = '/api/admin/productos';

function leerCatalogoMaestro(archivo = join(__dirname, '../../docs/309/catalogo-maestro.csv')) {
  const { data, errors } = parse(readFileSync(archivo, 'utf8'), { header: true, skipEmptyLines: true });
  assert.deepEqual(errors, [], `CSV de catálogo inválido: ${archivo}`);
  return data;
}

function seleccionarFuentesCatalogo(fuentes, filasCatalogo) {
  const skus = new Set();
  const seleccionadas = new Map();
  const pendientes = [];
  for (const fila of filasCatalogo) {
    const codigoFamilia = /^FP-DEMO-([A-Z]{3})-/.exec(fila.sku)?.[1];
    assert.ok(fila.sku && fila.nombre_propuesto && codigoFamilia === fila.familia && !skus.has(fila.sku),
      `SKU, nombre o familia inválidos en catálogo maestro: ${fila.sku}`);
    skus.add(fila.sku);
    const fuente = fuentes.get(fila.sku);
    if (!fuente) {
      pendientes.push(fila.sku);
      continue;
    }
    seleccionadas.set(fila.sku, { ...fuente, nombre: fila.nombre_propuesto });
  }
  assert.equal(skus.size, 100, 'El catálogo maestro debe contener exactamente 100 SKU únicos');
  return { fuentes: seleccionadas, pendientes, total: skus.size };
}

async function asociarFotos(admin, { aplicar = false, fuentes = leerFuentes() } = {}) {
  const productos = await admin.get(productosAdmin);
  assert.ok(Array.isArray(productos), 'El listado ADMIN no devolvió productos');
  const porSku = new Map(productos.map(producto => [producto.codigo, producto]));
  assert.equal(porSku.size, productos.length, 'El listado ADMIN contiene SKU duplicados');
  const resultado = [];
  for (const fuente of fuentes.values()) {
    const producto = porSku.get(fuente.sku);
    assert.ok(producto && Number.isSafeInteger(producto.id_producto) && producto.id_producto > 0 &&
      producto.nombre === fuente.nombre, `El SKU ${fuente.sku} falta o no coincide con el catálogo`);
  }
  for (const fuente of fuentes.values()) {
    const { id_producto: id } = porSku.get(fuente.sku);
    const endpoint = `${productosAdmin}/${id}`;
    const actual = aplicar ? await admin.get(endpoint) : porSku.get(fuente.sku);
    assert.equal(actual.id_producto, id);
    assert.equal(actual.codigo, fuente.sku);
    assert.equal(actual.nombre, fuente.nombre);
    if (actual.imagen || !aplicar) {
      resultado.push({ sku: fuente.sku, archivo: fuente.archivo, estado: actual.imagen ? 'conservada' : 'pendiente', imagen: actual.imagen });
      continue;
    }
    const guardado = await admin.subir(`${endpoint}/con-imagen`, fuente);
    assert.equal(guardado.id_producto, id);
    assert.equal(guardado.codigo, fuente.sku);
    assert.equal(guardado.nombre, fuente.nombre);
    assert.match(guardado.imagen, rutaAdministrada);
    resultado.push({ sku: fuente.sku, archivo: fuente.archivo, estado: 'asociada', imagen: guardado.imagen });
  }
  return resultado;
}

async function main() {
  const [url, ...opciones] = process.argv.slice(2);
  let aplicar = false;
  let archivoCatalogo;
  while (opciones.length) {
    const opcion = opciones.shift();
    if (opcion === '--aplicar' && !aplicar) aplicar = true;
    else if (opcion === '--catalogo' && !archivoCatalogo && opciones.length) archivoCatalogo = resolve(opciones.shift());
    else throw new Error('Uso: node asociar-fotos.cjs ORIGEN [--aplicar] [--catalogo RUTA]');
  }
  assert.ok(url, 'Uso: node asociar-fotos.cjs ORIGEN [--aplicar] [--catalogo RUTA]');
  const destino = new URL(url);
  assert.ok(destino.href === `${destino.origin}/` && (destino.protocol === 'https:' ||
    (destino.protocol === 'http:' && destino.hostname === '127.0.0.1')), 'Ingresá un origen HTTPS o loopback local');
  const { DEMO_ADMIN_EMAIL: email, DEMO_ADMIN_PASSWORD: password } = process.env;
  assert.ok(email && password, 'Configurá DEMO_ADMIN_EMAIL y DEMO_ADMIN_PASSWORD en la sesión');
  const solicitar = (path, options) => fetch(new URL(path, destino), {
    ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  const login = await solicitar('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: destino.origin },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(login.ok, `El inicio de sesión devolvió HTTP ${login.status}`);
  const cookie = login.headers.getSetCookie().find(value => value.startsWith('jwt_token='))?.split(';')[0];
  assert.ok(cookie, 'La instalación no emitió una sesión ADMIN');
  const headers = { Cookie: cookie, Origin: destino.origin };
  const json = async (path, options) => {
    const response = await solicitar(path, { ...options, headers });
    if (!response.ok) throw new Error(`${path} devolvió HTTP ${response.status}`);
    return response.json();
  };
  let fuentes = leerFuentes();
  let seleccionCatalogo;
  if (archivoCatalogo) {
    seleccionCatalogo = seleccionarFuentesCatalogo(fuentes, leerCatalogoMaestro(archivoCatalogo));
    fuentes = seleccionCatalogo.fuentes;
  }
  const resultado = await asociarFotos({
    get: path => json(path),
    async subir(path, { archivo, bytes }) {
      const body = new FormData();
      body.set('producto', '{}');
      body.set('imagen', new Blob([bytes], { type: 'image/webp' }), archivo);
      return json(path, { method: 'PUT', body });
    },
  }, { aplicar, fuentes });
  const salida = seleccionCatalogo
    ? { skuCatalogo: seleccionCatalogo.total, conFuente: fuentes.size, sinFuente: seleccionCatalogo.pendientes.length,
      pendientes: seleccionCatalogo.pendientes, asociaciones: resultado }
    : resultado;
  process.stdout.write(`${JSON.stringify(salida, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { asociarFotos, leerCatalogoMaestro, seleccionarFuentesCatalogo };
