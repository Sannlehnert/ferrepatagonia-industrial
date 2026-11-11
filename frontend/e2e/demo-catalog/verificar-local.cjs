const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const local = require('../../../backend/test/helpers/demo286-persistent.cjs');
const { credentials } = require('../../../backend/test/helpers/e2e-fixtures.cjs');

const baseURL = 'http://localhost:5173';
const mode = process.argv[2];
assert.ok(['--ensayar', '--continuar-comprobante', '--comprobar-reinicio'].includes(mode) && process.argv.length === 3);
assert.ok(fs.existsSync(local.ready), 'Primero iniciá la demo persistente.');
const profile = JSON.parse(fs.readFileSync(path.join(local.storage, 'perfil.json'), 'utf8'));
const proof = createHash('sha256').update('demo286:' + profile.token).digest('hex');
const evidence = path.join(local.storage, 'ensayo.json');
const sku = 'FP-DEMO-MAN-LLAVE-AJUSTABLE-150-MM';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=', 'base64');
const photoSelector = 'img[alt="Llave ajustable de 150 mm con mango metálico"]';

async function json(response, status = 200) {
  assert.equal(response.status(), status, new URL(response.url()).pathname);
  return response.json();
}

async function signIn(page, email, password = profile.accountPassword) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  const pending = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  const response = await pending;
  assert.ok(response.ok(), 'Ingreso de cuenta de prueba: HTTP ' + response.status());
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

async function accountOrder(page) {
  await page.goto('/mi-cuenta/pedidos');
  return page.getByRole('button', { name: /^Ver detalle de PED-/ });
}

async function main() {
  const { profile: running, fresh } = await local.openPersistent();
  assert.ok(!fresh && running.id === profile.id);
  const { connection: db } = await local.connectPersistent(running);
  let browser;
  let observerBrowser;
  try {
    const direct = await fetch('http://localhost:3000/api/health');
    assert.equal(direct.status, 200);
    assert.equal(direct.headers.get('X-Ferre-Demo'), proof);
    browser = await chromium.launch();
    const page = await browser.newPage({ baseURL, viewport: { width: 1280, height: 900 } });
    const health = await page.request.get('/api/health');
    assert.equal(health.headers()['x-ferre-demo'], proof, 'La web no apunta a la MariaDB exclusiva de la demo.');
    const [counts] = await db.query(`SELECT COUNT(*) AS sku, COUNT(imagen) AS fotos FROM PRODUCTO WHERE codigo LIKE 'FP-DEMO-%'`);
    assert.deepEqual([Number(counts.sku), Number(counts.fotos)], [904, 132]);
    const { data } = await json(await page.request.get('/api/catalogo?busqueda=' + sku));
    assert.equal(data.pagination.total, 1);
    const [{ id, imagen, nombre, categoria }] = data.productos;
    const { stock } = (await json(await page.request.get('/api/catalogo/' + id))).data.producto;
    assert.ok(Number.isInteger(stock) && stock > 0);
    const [image, home] = await Promise.all([page.request.get(imagen), page.goto('/')]);
    assert.equal(home.status(), 200);
    assert.equal(image.status(), 200);
    assert.equal(image.headers()['content-type'], 'image/webp');
    const photo = page.locator(photoSelector);
    await expect(photo).toBeVisible();
    assert.ok(await photo.evaluate(img => img.decode().then(() => img.naturalWidth)));
    await page.goto('/catalogo');
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Paginación del catálogo' })).toContainText(/Página 2 de /);
    await page.goto('/catalogo?busqueda=' + sku + '&categoria=' + categoria.id);
    const link = page.getByRole('link', { name: nombre, exact: true });
    await expect(link).toBeVisible();
    await page.goto(await link.getAttribute('href'));
    await expect(page.getByRole('heading', { name: nombre, level: 1 })).toBeVisible();
    await expect(photo).toBeVisible();
    const firmaFoto = createHash('sha256').update(await image.body()).digest('hex');

    if (mode === '--comprobar-reinicio') {
      const previous = JSON.parse(fs.readFileSync(evidence, 'utf8'));
      assert.equal(stock, previous.stockFinal);
      assert.equal(firmaFoto, previous.firmaFoto);
      const [persisted] = await db.query(`SELECT
        (SELECT COUNT(*) FROM PEDIDO WHERE id_pedido=? AND observaciones='Pedido simulado académico #286') AS pedido,
        (SELECT COUNT(*) FROM COMPROBANTE_PAGO WHERE id_comprobante=? AND revision_utc IS NOT NULL) AS revisados,
        (SELECT COUNT(*) FROM USUARIO WHERE email=?) AS nuevo`, [previous.pedidoId, previous.comprobanteId, previous.registro]);
      assert.deepEqual([Number(persisted.pedido), Number(persisted.nuevo)], [1, 1]);
      assert.ok(Number(persisted.revisados) >= 1);
      const particular = await browser.newPage({ baseURL });
      await signIn(particular, credentials.client.email);
      await (await accountOrder(particular)).click();
      const receipt = particular.locator('a[href$="/' + previous.comprobanteId + '"]');
      await expect(receipt).toBeVisible();
      const resource = await particular.request.get(await receipt.getAttribute('href'));
      assert.equal(resource.status(), 200);
      assert.deepEqual(await resource.body(), png);
      console.log('Reinicio verificado: 904 SKU, 132 fotos, stock, usuario, pedido y comprobante revisado con archivo intacto.');
      return;
    }

    assert.ok(!fs.existsSync(evidence), 'Ya se registró un ensayo; usá --comprobar-reinicio para evitar una compra adicional.');
    const [existing] = await db.query(`SELECT COUNT(*) AS total FROM PEDIDO WHERE observaciones='Pedido simulado académico #286'`);
    const company = await browser.newPage({ baseURL });
    const particular = await browser.newPage({ baseURL, acceptDownloads: true });
    const admin = await browser.newPage({ baseURL });
    await Promise.all([
      signIn(company, credentials.account.email),
      signIn(particular, credentials.client.email),
      signIn(admin, credentials.admin.email),
    ]);
    let registro;
    let order;
    const events = new Set();
    if (mode === '--ensayar') {
      assert.equal(Number(existing.total), 0, 'Ya hay un pedido académico; continuá con --continuar-comprobante.');
      registro = 'registro-demo-' + randomBytes(4).toString('hex') + '@e2e.test';
      const password = 'Demo-Registro-' + randomBytes(8).toString('hex');
      await page.goto('/registro');
      for (const [label, value] of Object.entries({
        Nombre: 'Registro', Apellido: 'Demostración', Email: registro, 'Teléfono': '299 5550100',
        'Contraseña': password, 'Repetir contraseña': password,
      })) await page.getByLabel(label, { exact: true }).fill(value);
      const registered = page.waitForResponse(r => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
      assert.ok((await registered).ok());
      await signIn(page, registro, password);

      observerBrowser = await chromium.launch();
      const observer = await observerBrowser.newPage({ baseURL });
      await signIn(observer, credentials.account.email);
      await admin.getByRole('link', { name: 'Productos', exact: true }).click();
      await admin.getByRole('textbox', { name: 'Buscar productos por nombre o SKU' }).fill(sku);
      await expect(admin.getByRole('button', { name: 'Editar ' + nombre, exact: true })).toBeVisible();
      // Real ADMIN write on the guarded demo, restored before checkout.
      const adminStock = quantity => admin.request.patch('/api/admin/productos/' + id + '/stock',
        { headers: { Origin: baseURL }, data: { stock: quantity } });
      try {
        assert.equal((await adminStock(stock + 1)).status(), 200);
        assert.equal((await json(await page.request.get('/api/catalogo/' + id))).data.producto.stock, stock + 1);
      } finally { assert.equal((await adminStock(stock)).status(), 200); }

      observer.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string' || !payload.startsWith('42')) return;
        const [name, data] = JSON.parse(payload.slice(2));
        if (name !== 'stock.actualizado.v1' || data.productosIds.includes(id)) events.add(name);
      }));
      await observer.goto('/producto/' + id);
      await expect(observer.getByText(new RegExp(stock + ' unidades disponibles'))).toBeVisible();
      await company.goto('/producto/' + id);
      await expect(company.getByText(/Precio simulado académico/)).toBeVisible();
      await company.getByRole('button', { name: 'Agregar', exact: true }).click();
      await company.getByRole('link', { name: 'Ver carrito completo' }).click();
      await expect(company.getByText(/Pedido simulado académico · sin cargo real/)).toBeVisible();
      await company.getByRole('radio', { name: 'Cuenta corriente' }).check();
      const confirmation = company.waitForResponse(r => r.url().endsWith('/api/pedidos/cuenta-corriente') && r.request().method() === 'POST');
      await company.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click();
      order = (await json(await confirmation, 201)).data;
      assert.equal(order.simulado, true);
      await expect(company.getByRole('list', { name: 'Comprobantes de pedidos confirmados' })).toContainText('Pedido simulado');
      await expect(observer.getByText(new RegExp((stock - 1) + ' unidades disponibles'))).toBeVisible();
      await expect.poll(() => [...events]).toEqual(expect.arrayContaining(['stock.actualizado.v1', 'pedido.confirmado.v1']));
    } else {
      assert.equal(Number(existing.total), 1, 'Para continuar debe existir un único pedido académico.');
      const [persisted] = await db.query(`SELECT p.id_pedido, m.id_movimiento_cuenta FROM PEDIDO p
        JOIN MOVIMIENTO_CUENTA_CORRIENTE m USING (id_pedido) WHERE p.observaciones='Pedido simulado académico #286'`);
      order = { pedidoId: Number(persisted.id_pedido), cargoId: String(persisted.id_movimiento_cuenta) };
      const [account] = await db.query("SELECT email FROM USUARIO WHERE email LIKE 'registro-demo-%' ORDER BY id_usuario DESC LIMIT 1");
      registro = account?.email;
      assert.ok(registro, 'No se encontró el usuario creado durante el ensayo.');
    }
    await expect((await accountOrder(company)).first()).toBeVisible();

    await (await accountOrder(particular)).click();
    const region = particular.getByRole('region', { name: 'Comprobantes de pago' });
    await region.getByLabel(/Archivo \(PDF/).setInputFiles({ name: 'comprobante-academico.png', mimeType: 'image/png', buffer: png });
    const uploading = particular.waitForResponse(r => /\/api\/pedidos\/\d+\/comprobantes$/.test(r.url()) && r.request().method() === 'POST');
    await region.getByRole('button', { name: 'Adjuntar comprobante' }).click();
    const uploaded = await uploading;
    assert.ok([200, 201].includes(uploaded.status()), 'Carga de comprobante: ' + uploaded.status() + ' ' + await uploaded.text());
    const comprobanteId = (await uploaded.json()).data.id;
    assert.match(comprobanteId, /^[a-f0-9-]{36}$/);
    const linkReceipt = region.locator('a[href$="/' + comprobanteId + '"]');
    await expect(linkReceipt).toBeVisible();
    const download = await linkReceipt.getAttribute('href');
    const receipt = await particular.request.get(download);
    assert.equal(receipt.status(), 200);
    assert.deepEqual(await receipt.body(), png);
    assert.equal((await company.request.get(download)).status(), 404);
    await admin.getByRole('link', { name: 'Comprobantes de pago', exact: true }).click();
    const row = admin.getByRole('region', { name: 'Comprobantes de pago' }).getByRole('listitem')
      .filter({ has: admin.locator('a[href$="/' + comprobanteId + '"]') });
    const mark = row.getByRole('button', { name: 'Marcar revisado' });
    await expect(row).toBeVisible();
    if (await mark.count()) await mark.click();
    await expect(row.getByText(/^Revisado/)).toBeVisible();

    const [effects] = await db.query(`SELECT
      (SELECT COUNT(*) FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido=? AND tipo_movimiento='CARGO'
        AND observaciones='Pedido simulado académico #286') AS cargos,
      (SELECT COUNT(*) FROM PAGO) AS pagos`, [order.pedidoId]);
    assert.deepEqual([Number(effects.cargos), Number(effects.pagos)], [1, 0]);
    const result = { sku, foto: imagen, firmaFoto, registro, pedidoId: order.pedidoId, cargoId: order.cargoId, comprobanteId,
      stockInicial: mode === '--ensayar' ? stock : null, stockFinal: mode === '--ensayar' ? stock - 1 : stock,
      socket: [...events], comprobanteRevisado: true, pagos: 0 };
    fs.writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await Promise.all([browser?.close(), observerBrowser?.close(), db.end()]);
  }
}

main().catch(error => {
  console.error(error.stack?.replaceAll(profile.accountPassword, '[oculto]') ?? error.message);
  process.exitCode = 1;
});
