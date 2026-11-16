require('./helpers/integration-lifecycle.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { spawnSync } = require('node:child_process');
const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
const { createAuthUser } = require('./helpers/auth-user.cjs');
const { pool } = require('../dist/config/catalog-snapshot.config.js');
const { dataSource } = require('../dist/config/database.config.js');
const {
  PriceVerificationError,
  verifyProductPrice,
  listPriceHistory,
} = require('../dist/services/pricing/price-verification.js');
const { insertImportedProductsBatch } = require('../dist/repositories/productImport.repository.js');

assert.match(process.env.DB_NAME || '', /^price_verification_test_[a-f0-9]{32}$/);
assert.equal(process.env.DB_NAME, process.env.PRICE_VERIFICATION_TEST_DATABASE);

const RUN_ID = process.env.PRICE_VERIFICATION_RUN_ID;
assert.ok(RUN_ID && RUN_ID.length >= 16, 'Falta el identificador aislado de la corrida');

let server;
let app;
let baseUrl;
let admin;
let client;
let categoryId;
let productId;

const api = async (method, route, body, cookie, headers = {}) => {
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${route}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};

const createProduct = async (codigo, precio) => {
  const response = await api('POST', '/api/admin/productos', {
    id_categoria: categoryId, codigo, nombre: `Producto ${codigo}`,
    precio, stock: 10, activo: true,
  }, admin.cookie);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return Number(body.id_producto);
};

const priceLine = async (id, cookie) => {
  const response = await api('POST', cookie ? '/api/precios/mios' : '/api/precios',
    { moneda: 'USD', productos: [{ productoId: id, cantidad: 1 }] }, cookie);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data.productos[0];
};

const evidenceRow = async id => {
  const [row] = await pool.query(
    `SELECT id_producto,precio_verificado,evidencia,id_admin,valida,sintetica,
      DATE_FORMAT(verificado_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS verificado_utc
     FROM PRECIO_USD_EVIDENCIA WHERE id_producto = ?`, [id]);
  return row;
};

const verify = (id, price, evidence, adminId = admin.id) =>
  verifyProductPrice({ productId: id, expectedPrice: price, evidence, adminId, confirmed: true });

const rejectCode = code => error => {
  assert.ok(error instanceof PriceVerificationError, String(error));
  assert.equal(error.code, code);
  return true;
};

function instrumentQueries(intercept) {
  const original = dataSource.createQueryRunner;
  dataSource.createQueryRunner = function (...args) {
    const runner = original.apply(this, args);
    const query = runner.query.bind(runner);
    runner.query = (sql, ...params) => intercept(runner, () => query(sql, ...params), sql, params[0]);
    return runner;
  };
  return () => { dataSource.createQueryRunner = original; };
}

async function waitFor(description, predicate) {
  const deadline = Date.now() + 3000;
  do {
    if (await predicate()) return;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail(`No se observó a tiempo: ${description}`);
}

async function lockWait(waiter, holder) {
  const [row] = await pool.query(`SELECT 1 AS waiting
    FROM information_schema.INNODB_LOCK_WAITS w
    JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
    JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_trx_id
    WHERE r.trx_mysql_thread_id = ? AND b.trx_mysql_thread_id = ?`, [waiter, holder]);
  return row?.waiting === 1;
}

describe('T-S7-05.2 — Flujo autorizado de verificación de precios', () => {
  before(async () => {
    const rows = await pool.query('SELECT COUNT(*) AS total FROM CATEGORIA');
    assert.equal(Number(rows[0].total), 0, 'La suite requiere una base desechable sin seed');
    admin = await createAuthUser(pool);
    client = await createAuthUser(pool, 'CLIENTE');
    const list = await pool.query(
      "INSERT INTO LISTA_PRECIO (nombre,porcentaje_descuento,activa) VALUES (?, '10.00', 1)",
      [`Lista T-S7-05.2 ${RUN_ID}`],
    );
    await pool.query('UPDATE CLIENTE SET id_lista_precio = ? WHERE id_cliente = ?',
      [Number(list.insertId), client.clientId]);
    const category = await pool.query(
      "INSERT INTO CATEGORIA (nombre,activo) VALUES (?, 1)", [`Categoría T-S7-05.2 ${RUN_ID}`]);
    categoryId = Number(category.insertId);
    ({ app } = require('../dist/app.js'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await pool.end();
  });

  test('1. Alta: precio exacto, sin evidencia comercial y FER17 no publica un importe', async () => {
    productId = await createProduct(`T-S7-05-2-ALTA-${RUN_ID}`, 100.123);
    const [product] = await pool.query(
      'SELECT precio, DATE_FORMAT(fecha_actualizacion,\'%Y-%m-%d\') AS fecha FROM PRODUCTO WHERE id_producto = ?',
      [productId]);
    assert.equal(product.precio, '100.12');
    assert.equal(await evidenceRow(productId), undefined);
    const line = await priceLine(productId);
    assert.equal(line.estadoPrecio, 'BASE_NO_VERIFICADA');
    assert.equal(line.precioBaseUSD, null);
    assert.equal(line.precioUnitarioUSD, null);
    assert.equal(line.precioComprable, false);
    assert.equal(Object.hasOwn(line, 'evidenciaBaseUSD'), false);
    const history = await listPriceHistory(productId);
    assert.equal(history[0].tipo, 'ALTA');
    assert.equal(history[0].precioNuevo, '100.12');
    assert.equal(history[0].adminId, admin.id);
  });

  test('2. Verificación autorizada: DEFINIDO, precio público y descuento particular exactos', async () => {
    const evidence = `Factura FER-320-A-${RUN_ID} proveedor Andes, folio 0001`;
    const result = await verify(productId, '100.12', evidence);
    assert.equal(result.ok, true);
    assert.equal(result.price, '100.12');
    assert.equal(result.estadoFer17, 'DEFINIDO');
    assert.equal(result.publicado, true);
    assert.equal(result.adminId, admin.id);
    assert.equal(result.adminEmail, admin.email);
    const row = await evidenceRow(productId);
    assert.equal(row.valida, 1);
    assert.equal(row.sintetica, 0);
    assert.equal(row.evidencia, evidence);
    assert.equal(row.id_admin, admin.id);
    assert.match(row.verificado_utc, /Z$/);

    const publicLine = await priceLine(productId);
    assert.equal(publicLine.estadoPrecio, 'DEFINIDO');
    assert.equal(publicLine.precioBaseUSD, '100.12');
    assert.equal(publicLine.precioUnitarioUSD, '100.12');
    assert.equal(publicLine.subtotalUSD, '100.12');
    assert.equal(publicLine.evidenciaBaseUSD.reference, evidence);
    assert.equal(publicLine.evidenciaBaseUSD.synthetic, false);

    const clientLine = await priceLine(productId, client.cookie);
    assert.equal(clientLine.estadoPrecio, 'DEFINIDO');
    assert.equal(clientLine.descuentoAplicado, '10.00');
    assert.equal(clientLine.origenDescuento, 'LISTA');
    assert.equal(clientLine.precioUnitarioUSD, '90.11');
    assert.equal(clientLine.subtotalUSD, '90.11');

    const history = await listPriceHistory(productId);
    assert.equal(history[0].tipo, 'VERIFICACION');
    assert.equal(history[0].precioNuevo, '100.12');
    assert.equal(history[0].evidencia, evidence);
  });

  test('7. Edición no monetaria: conserva la verificación vigente', async () => {
    const response = await api('PUT', `/api/admin/productos/${productId}`,
      { nombre: `Producto renombrado ${RUN_ID}` }, admin.cookie);
    assert.equal(response.status, 200);
    assert.equal((await evidenceRow(productId)).valida, 1);
    assert.equal((await priceLine(productId)).estadoPrecio, 'DEFINIDO');
    const history = await listPriceHistory(productId);
    assert.equal(history.some(event => event.tipo === 'CAMBIO_PRECIO'), false);
  });

  test('5. Edición del importe: invalida evidencia y auditoría en la misma transacción', async () => {
    const response = await api('PUT', `/api/admin/productos/${productId}`,
      { precio: 120 }, admin.cookie);
    assert.equal(response.status, 200);
    const row = await evidenceRow(productId);
    assert.equal(row.precio_verificado, '100.12');
    assert.equal(row.valida, 0);
    const line = await priceLine(productId);
    assert.equal(line.estadoPrecio, 'BASE_NO_VERIFICADA');
    assert.equal(line.precioComprable, false);
    const history = await listPriceHistory(productId);
    const change = history.find(event => event.tipo === 'CAMBIO_PRECIO');
    const invalidation = history.find(event => event.tipo === 'INVALIDACION');
    assert.equal(change.precioAnterior, '100.12');
    assert.equal(change.precioNuevo, '120.00');
    assert.equal(change.adminId, admin.id);
    assert.equal(invalidation.precioAnterior, '100.12');
    assert.equal(invalidation.precioNuevo, '120.00');
    assert.match(invalidation.evidencia, /FER-320-A/);
    assert.equal(invalidation.adminId, admin.id);
  });

  test('6. USD 100.12 → 120.00 → 100.12: la evidencia original no se rehabilita', async () => {
    const response = await api('PUT', `/api/admin/productos/${productId}`,
      { precio: 100.12 }, admin.cookie);
    assert.equal(response.status, 200);
    const row = await evidenceRow(productId);
    assert.equal(row.valida, 0);
    assert.equal(row.precio_verificado, '100.12');
    const line = await priceLine(productId);
    assert.equal(line.estadoPrecio, 'BASE_NO_VERIFICADA');
    assert.equal(line.precioBaseUSD, null);
    const history = await listPriceHistory(productId);
    assert.equal(history.filter(event => event.tipo === 'INVALIDACION').length, 1);
  });

  test('8. Nueva revisión posterior: evidencia nueva vuelve a DEFINIDO y conserva la anterior', async () => {
    const evidence = `Lista de precios FER-320-B-${RUN_ID} proveedor Andes, revisión 2`;
    const result = await verify(productId, '100.12', evidence);
    assert.equal(result.ok, true);
    assert.equal(result.estadoFer17, 'DEFINIDO');
    assert.match(result.previousEvidence, /FER-320-A/);
    const row = await evidenceRow(productId);
    assert.equal(row.valida, 1);
    assert.equal(row.evidencia, evidence);
    const history = await listPriceHistory(productId);
    assert.equal(history[0].tipo, 'VERIFICACION');
    assert.equal(history[0].evidencia, evidence);
    assert.match(history[0].evidenciaAnterior, /FER-320-A/);
  });

  test('9. Evidencia vacía, genérica o sintética: rechazo sin evidencia comercial', async () => {
    const before = await evidenceRow(productId);
    const eventsBefore = (await listPriceHistory(productId, 200)).length;
    await assert.rejects(verify(productId, '100.12', '   '), rejectCode('EVIDENCIA_INVALIDA'));
    await assert.rejects(verify(productId, '100.12', 'verificado'), rejectCode('EVIDENCIA_INVALIDA'));
    await assert.rejects(verify(productId, '100.12', 'test'), rejectCode('EVIDENCIA_INVALIDA'));
    await assert.rejects(verify(productId, '100.12', 'SINTETICO fixture 123'), rejectCode('EVIDENCIA_SINTETICA'));
    const after = await evidenceRow(productId);
    assert.equal(after.evidencia, before.evidencia);
    assert.equal(after.valida, 1);
    assert.equal((await listPriceHistory(productId, 200)).length, eventsBefore);
  });

  test('10. Actor no autorizado, inactivo o inexistente: rechazo', async () => {
    await assert.rejects(verify(productId, '100.12', `Factura FER-320-C-${RUN_ID}`, client.id),
      rejectCode('ACTOR_NO_AUTORIZADO'));
    const inactive = await createAuthUser(pool);
    await pool.query('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [inactive.id]);
    await assert.rejects(verify(productId, '100.12', `Factura FER-320-D-${RUN_ID}`, inactive.id),
      rejectCode('ACTOR_NO_AUTORIZADO'));
    await assert.rejects(verify(productId, '100.12', `Factura FER-320-E-${RUN_ID}`, 2147483647),
      rejectCode('ACTOR_NO_AUTORIZADO'));
    await assert.rejects(verify(2147483647, '100.12', `Factura FER-320-E-${RUN_ID}`, client.id),
      rejectCode('ACTOR_NO_AUTORIZADO'));
    assert.equal((await evidenceRow(productId)).valida, 1);
  });

  test('11. Producto inexistente e importe esperado desactualizado: rechazo explícito', async () => {
    await assert.rejects(verify(2147483647, '100.12', `Factura FER-320-F-${RUN_ID}`),
      rejectCode('PRODUCTO_INEXISTENTE'));
    const result = await verify(productId, '99.99', `Factura FER-320-G-${RUN_ID}`);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'IMPORTE_NO_COINCIDE');
    assert.ok(result.eventId);
    assert.equal((await evidenceRow(productId)).valida, 1);
    const history = await listPriceHistory(productId);
    assert.equal(history[0].tipo, 'RECHAZO');
    assert.equal(history[0].resultado, 'RECHAZADO');
    assert.equal(history[0].motivo, 'IMPORTE_NO_COINCIDE');
    assert.equal(history[0].precioAnterior, '100.12');
    assert.equal(history[0].precioNuevo, '99.99');
  });

  test('13. Dos verificaciones concurrentes del mismo importe: resultado consistente', async () => {
    const evidence = `Factura FER-320-H-${RUN_ID} revisión concurrente`;
    const results = await Promise.all([
      verify(productId, '100.12', evidence),
      verify(productId, '100.12', evidence),
    ]);
    assert.equal(results.every(result => result.ok), true);
    const rows = await pool.query(
      'SELECT * FROM PRECIO_USD_EVIDENCIA WHERE id_producto = ?', [productId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].valida, 1);
    assert.equal(rows[0].evidencia, evidence);
    const history = await listPriceHistory(productId, 200);
    assert.equal(history.filter(event =>
      event.tipo === 'VERIFICACION' && event.evidencia === evidence).length, 2);
    assert.equal((await priceLine(productId)).estadoPrecio, 'DEFINIDO');
  });

  test('Checkout CC y verificación contienden por el mismo producto con el mismo operador de evidencia', { timeout: 15000 }, async () => {
    const id = await createProduct(`FER320-CHECKOUT-${RUN_ID}`, 25);
    const buyer = await createAuthUser(pool, 'CLIENTE');
    await pool.query(`UPDATE CLIENTE SET tipo_cliente='EMPRESA', estado_aprobacion_empresa='APROBADA'
      WHERE id_cliente=?`, [buyer.clientId]);
    await pool.query(`INSERT INTO CUENTA_CORRIENTE
      (id_cliente,limite_credito,habilitada,cobertura,plazo_dias,moneda_limite,
       evidencia_limite,evidencia_plazo,evidencia_cobertura,cobertura_desde_utc,origen_datos)
      VALUES (?,1000,1,'COMPLETA',30,'USD','Crédito 1','Acuerdo 2','Extracto 3',
        UTC_TIMESTAMP(3) - INTERVAL 1 DAY,'DEMO')`, [buyer.clientId]);
    const cart = await pool.query('INSERT INTO CARRITO(id_cliente) VALUES (?)', [buyer.clientId]);
    await pool.query('INSERT INTO ITEM_CARRITO(id_carrito,id_producto,cantidad) VALUES (?,?,2)',
      [Number(cart.insertId), id]);
    assert.equal((await verify(id, '25.00', 'Factura Andes 001-240, revisión original')).ok, true);
    const eligibility = await api('GET', '/api/pedidos/cuenta-corriente/eligibilidad', undefined, buyer.cookie);
    assert.equal(eligibility.status, 200);
    const quote = (await eligibility.json()).data.cotizacion;
    assert.ok(quote);

    let checkoutThread, verificationThread;
    const gate = Promise.withResolvers();
    const restore = instrumentQueries(async (runner, query, sql, params) => {
      if (params?.[0] === id && /SELECT id_admin AS adminId/.test(sql)) {
        const result = await query();
        checkoutThread = (await runner.connect()).threadId;
        await gate.promise; // Checkout holds PRODUCTO and evidence, and has not read the ADMIN yet.
        return result;
      }
      if (params?.[0] === id && /SELECT id_producto,precio,activo FROM PRODUCTO/.test(sql)) {
        verificationThread = (await runner.connect()).threadId;
      }
      return query();
    });
    const checkout = api('POST', '/api/pedidos/cuenta-corriente', { cotizacion: quote },
      buyer.cookie, { 'Idempotency-Key': randomUUID() });
    checkout.catch(() => {});
    const reference = 'Factura Andes 001-240, revisión independiente';
    let verification;
    try {
      await waitFor('checkout con los bloqueos previos al ADMIN', () => checkoutThread);
      verification = verify(id, '25.00', reference);
      verification.catch(() => {});
      await waitFor('espera real de InnoDB por el producto', () =>
        verificationThread && lockWait(verificationThread, checkoutThread));
      gate.resolve();
      const [response, verified] = await Promise.all([checkout, verification]);
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.equal(verified.ok, true);
      assert.equal(body.data.totalUSD, '50.00');
      const [order] = await pool.query('SELECT total,modalidad_pago FROM PEDIDO WHERE id_pedido=?', [body.data.pedidoId]);
      assert.equal(order.total, '50.00');
      assert.equal(order.modalidad_pago, 'CUENTA_CORRIENTE');
      const [product] = await pool.query('SELECT stock FROM PRODUCTO WHERE id_producto=?', [id]);
      assert.equal(product.stock, 8);
      assert.equal((await evidenceRow(id)).evidencia, reference);
      assert.equal((await evidenceRow(id)).id_admin, admin.id);
      const history = await listPriceHistory(id);
      assert.deepEqual(history.map(event => event.tipo), ['VERIFICACION', 'VERIFICACION', 'ALTA']);
      assert.equal(history[0].evidenciaAnterior, 'Factura Andes 001-240, revisión original');
    } finally {
      gate.resolve();
      await Promise.allSettled([checkout, verification]);
      restore();
    }
  });

  test('El mismo ADMIN puede verificar dos productos todavía sin evidencia al mismo tiempo', { timeout: 15000 }, async () => {
    const first = await createProduct(`FER320-PAR-A-${RUN_ID}`, 22);
    const second = await createProduct(`FER320-PAR-B-${RUN_ID}`, 33);
    const threads = new Set();
    const gate = Promise.withResolvers();
    const restore = instrumentQueries(async (runner, query, sql, params) => {
      if ([first, second].includes(params?.[0]) && /INSERT INTO PRECIO_USD_EVIDENCIA/.test(sql)) {
        threads.add((await runner.connect()).threadId);
        await gate.promise;
      }
      return query();
    });
    const pending = [
      verify(first, '22.00', 'Factura Sur 001-101, folio 2'),
      verify(second, '33.00', 'Factura Sur 001-102, folio 3'),
    ];
    pending.forEach(work => work.catch(() => {}));
    try {
      await waitFor('dos transacciones con el mismo ADMIN bloqueado en lectura', () => threads.size === 2);
      gate.resolve();
      assert.ok((await Promise.all(pending)).every(result => result.ok));
      for (const [id, price] of [[first, '22.00'], [second, '33.00']]) {
        const row = await evidenceRow(id);
        assert.equal(row.id_admin, admin.id);
        assert.equal(row.valida, 1);
        assert.equal(row.precio_verificado, price);
        assert.deepEqual((await listPriceHistory(id)).map(event => event.tipo), ['VERIFICACION', 'ALTA']);
      }
    } finally {
      gate.resolve();
      await Promise.allSettled(pending);
      restore();
    }
  });

  test('14. Concurrencia precio/verificación: no se aprueba un importe ya modificado', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('SELECT id_producto FROM PRODUCTO WHERE id_producto = ? FOR UPDATE', [productId]);
      await runner.query('UPDATE PRODUCTO SET precio = 140.00 WHERE id_producto = ?', [productId]);
      const pending = verify(productId, '100.12', `Factura FER-320-I-${RUN_ID} carrera`);
      await new Promise(resolve => setTimeout(resolve, 150));
      await runner.commitTransaction();
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(result.code, 'IMPORTE_NO_COINCIDE');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    const row = await evidenceRow(productId);
    assert.equal(row.precio_verificado, '100.12');
    assert.equal(row.valida, 0);
    assert.equal((await priceLine(productId)).estadoPrecio, 'BASE_NO_VERIFICADA');
  });

  test('15. Error de base durante la verificación: rollback sin escritura parcial', async () => {
    const rollbackProduct = await createProduct(`T-S7-05-2-ROLLBACK-${RUN_ID}`, 50);
    const evidence = `Factura FER-320-J-${RUN_ID} rollback`;
    await dataSource.query('DROP TRIGGER IF EXISTS test_fail_price_event');
    await dataSource.query(`CREATE TRIGGER test_fail_price_event BEFORE INSERT ON FER17_PRECIO_EVENTO
      FOR EACH ROW BEGIN
        IF NEW.evidencia = '${evidence}' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEST_FAIL_PRICE_EVENT';
        END IF;
      END`);
    try {
      await assert.rejects(verify(rollbackProduct, '50.00', evidence));
    } finally {
      await dataSource.query('DROP TRIGGER IF EXISTS test_fail_price_event');
    }
    assert.equal(await evidenceRow(rollbackProduct), undefined);
    const history = await listPriceHistory(rollbackProduct);
    assert.equal(history.filter(event => event.evidencia === evidence).length, 0);
    assert.equal((await priceLine(rollbackProduct)).estadoPrecio, 'BASE_NO_VERIFICADA');
  });

  test('16. Evidencia sintética: no se promociona sola; la revisión manual la reemplaza', async () => {
    const syntheticProduct = await createProduct(`T-S7-05-2-SYNTH-${RUN_ID}`, 70);
    await pool.query(
      `INSERT INTO PRECIO_USD_EVIDENCIA
        (id_producto,precio_verificado,evidencia,id_admin,verificado_utc,valida,sintetica)
       VALUES (?,70.00,'SINTETICO fixture aislado T-S7-05.2',?, '2020-01-01 12:00:00',1,1)`,
      [syntheticProduct, admin.id],
    );
    const syntheticLine = await priceLine(syntheticProduct);
    assert.equal(syntheticLine.estadoPrecio, 'DEFINIDO');
    assert.equal(syntheticLine.evidenciaBaseUSD.synthetic, true);
    await api('PUT', `/api/admin/productos/${syntheticProduct}`,
      { nombre: `Producto sintético renombrado ${RUN_ID}` }, admin.cookie);
    assert.equal((await evidenceRow(syntheticProduct)).sintetica, 1);
    const result = await verify(syntheticProduct, '70.00', `Factura FER-320-K-${RUN_ID} revisión real`);
    assert.equal(result.ok, true);
    const row = await evidenceRow(syntheticProduct);
    assert.equal(row.sintetica, 0);
    assert.equal((await priceLine(syntheticProduct)).evidenciaBaseUSD.synthetic, false);
  });

  test('17. Importación administrativa: alta sin evidencia y con actor auditado', async () => {
    const codigo = `T-S7-05-2-IMPORT-${RUN_ID}`;
    const result = await insertImportedProductsBatch([{
      rowNumber: 1, codigo, nombre: 'Producto importado T-S7-05.2',
      precio_base_usd: 55.5, stock: 2, id_categoria: categoryId, activo: true,
    }], undefined, admin.id);
    const outcome = result.outcomes.get(1);
    assert.equal(result.uncertainRowNumbers.size, 0);
    assert.equal(outcome.success, true);
    assert.equal(await evidenceRow(outcome.id_producto), undefined);
    const history = await listPriceHistory(outcome.id_producto);
    assert.equal(history[0].tipo, 'ALTA');
    assert.equal(history[0].precioNuevo, '55.50');
    assert.equal(history[0].adminId, admin.id);
    assert.equal((await priceLine(outcome.id_producto)).estadoPrecio, 'BASE_NO_VERIFICADA');
  });

  test('18. Procedimiento local autorizado (CLI) e historial consultable', async () => {
    const cliProduct = await createProduct(`T-S7-05-2-CLI-${RUN_ID}`, 60);
    const evidence = `Factura FER-320-L-${RUN_ID} operación CLI aislada`;
    const verifyRun = spawnSync(process.execPath, [
      'scripts/verify-product-price.cjs',
      '--producto', String(cliProduct),
      '--importe', '60.00',
      '--evidencia', evidence,
      '--admin', String(admin.id),
      '--confirmar',
    ], { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 60000 });
    assert.equal(verifyRun.status, 0, verifyRun.stderr);
    assert.match(verifyRun.stdout, /FER17-v1: DEFINIDO/);
    const row = await evidenceRow(cliProduct);
    assert.equal(row.valida, 1);
    assert.equal(row.evidencia, evidence);

    const historyRun = spawnSync(process.execPath, [
      'scripts/verify-product-price.cjs',
      '--historial', '--producto', String(cliProduct), '--json',
    ], { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 60000 });
    assert.equal(historyRun.status, 0, historyRun.stderr);
    const history = JSON.parse(historyRun.stdout);
    assert.equal(history.eventos[0].tipo, 'VERIFICACION');
    assert.equal(history.eventos[0].evidencia, evidence);
    assert.equal(history.eventos.some(event => event.tipo === 'ALTA'), true);
    assert.equal((await priceLine(cliProduct)).estadoPrecio, 'DEFINIDO');
  });

  test('19. Historial completo y persistencia preparada para reinicio', async () => {
    const history = await listPriceHistory(productId, 200);
    const types = new Set(history.map(event => event.tipo));
    for (const type of ['ALTA', 'VERIFICACION', 'CAMBIO_PRECIO', 'INVALIDACION', 'RECHAZO']) {
      assert.equal(types.has(type), true, `Falta el evento ${type}`);
    }
    assert.equal(history.every(event => /Z$/.test(event.ocurridoUtc)), true);
    const ids = history.map(event => Number(event.idEvento));
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));

    const persistenceSku = `T-S7-05-2-PERSIST-${RUN_ID}`;
    const persistenceProduct = await createProduct(persistenceSku, 88.88);
    const persistenceEvidence = `Factura FER-320-PERSIST-${RUN_ID} persistencia`;
    const result = await verify(persistenceProduct, '88.88', persistenceEvidence);
    assert.equal(result.ok, true);
    assert.equal(result.estadoFer17, 'DEFINIDO');
  });
});
