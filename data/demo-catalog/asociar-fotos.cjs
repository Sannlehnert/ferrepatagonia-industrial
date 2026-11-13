const assert = require('node:assert/strict');
const { leerFuentes } = require('./cobertura-visual.cjs');

const rutaAdministrada = /^\/api\/product-images\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.webp$/;
const productosAdmin = '/api/admin/productos';

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
  const [url, opcion, ...extras] = process.argv.slice(2);
  assert.ok(url && (!opcion || opcion === '--aplicar') && !extras.length,
    'Uso: node asociar-fotos.cjs ORIGEN [--aplicar]');
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
  const resultado = await asociarFotos({
    get: path => json(path),
    async subir(path, { archivo, bytes }) {
      const body = new FormData();
      body.set('producto', '{}');
      body.set('imagen', new Blob([bytes], { type: 'image/webp' }), archivo);
      return json(path, { method: 'PUT', body });
    },
  }, { aplicar: opcion === '--aplicar' });
  process.stdout.write(`${JSON.stringify(resultado, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { asociarFotos };
