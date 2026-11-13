const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { childProfile, connectOwned, assertOwned } = require('./helpers/cc260-disposable.cjs');
const { seedFixtures, credentials } = require('./helpers/e2e-fixtures.cjs');
const { seedAdminAccounts } = require('./helpers/admin-account-fixture.cjs');

const profile = childProfile(258);
const db = require('../dist/config/database.config');
const ledger = require('../dist/repositories/cuentaCorriente.repository');
const { app } = require('../dist/app');
const { signToken } = require('../dist/services/token.service');
const { signCursor, decodeSignedAccountCursor, CURSOR_TTL_MS } = require('../dist/services/cuentaCorriente.service');
const jwt = require('jsonwebtoken');
let session, server, base, fixture;
const admin = signToken({ id: 1, rol: 'ADMIN' });
const client = signToken({ id: 2, rol: 'CLIENTE' });

before(async () => {
  session = await connectOwned(profile, 258);
  await seedFixtures(session.connection, { includeAccountOrderFixture: false });
  await db.initializeDatabase();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  try {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.destroyDatabase();
  } finally {
    await session?.connection.end();
  }
});

async function request(path, token = admin) {
  const response = await fetch(base + path, { headers: token ? { Cookie: `jwt_token=${token}` } : {} });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('vary'), /(?:^|,\s*)Cookie(?:,|$)/i);
  return { status: response.status, body: await response.json() };
}
const list = '/admin/cuentas-corrientes';
const detail = (clientId, segment = '') => `/admin/clientes/${clientId}/cuenta-corriente${segment}`;
const account = key => fixture.accounts[key];
const pathFor = (key, segment) => detail(account(key).clientId, segment);
const cursorParam = cursor => 'cursor=' + encodeURIComponent(cursor);
async function data(path, token = admin) {
  const result = await request(path, token);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.data;
}
async function expectCode(path, status, code, token = admin) {
  const result = await request(path, token);
  assert.equal(result.status, status, JSON.stringify(result.body));
  if (code) assert.equal(result.body.code, code);
  assert.equal(result.body.data, undefined);
}

test('listado vacío real y alta de los escenarios aislados', async () => {
  const empty = await data(list);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.siguienteCursor, null);
  await assertOwned(session);
  fixture = await seedAdminAccounts(session);
});

for (const [label, segment] of [['listado', null], ['resumen', ''], ['movimientos', '/movimientos'], ['vencimientos', '/vencimientos']]) {
  const route = () => segment === null ? list : pathFor('debt', segment);
  for (const [kind, token, status] of [
    ['visitante', null, 401], ['CLIENTE', client, 403], ['token inválido', 'invalid', 401],
    ['token expirado', jwt.sign({ id: 1, rol: 'ADMIN', exp: 1 }, process.env.JWT_SECRET), 401],
  ]) {
    test(`${label} rechaza ${kind}`, () => expectCode(route(), status, null, token));
  }
  test(`${label} rechaza ADMIN inactivo`, async () => {
    await session.connection.query('UPDATE USUARIO SET activo=0 WHERE id_usuario=1');
    try { await expectCode(route(), 401); }
    finally { await session.connection.query('UPDATE USUARIO SET activo=1 WHERE id_usuario=1'); }
  });
  test(`${label} devuelve 200 a ADMIN activo con privacidad`, async () => {
    const dto = await data(route());
    assert.match(dto.revision, /^[a-f0-9]{64}$/);
    assert.match(dto.corte, /Z$/);
  });
}

test('rol antes de ID y destino, ausencia de cliente y ausencia de cuenta', async () => {
  await expectCode(detail(2147483648), 403, null, client);
  await expectCode(detail(2147483647), 403, null, client);
  for (const segment of ['', '/movimientos', '/vencimientos']) {
    await expectCode(detail(2147483648, segment), 400, 'CONSULTA_INVALIDA');
    await expectCode(detail(2147483647, segment), 404, 'CLIENTE_NO_ENCONTRADO');
    assert.equal((await data(detail(1, segment))).estado, 'SIN_CUENTA');
  }
  assert.equal((await data('/admin/CLIENTES/1/CUENTA-CORRIENTE')).estado, 'SIN_CUENTA');
});
for (const query of ['limite=0', 'limite=101', 'limite=25&limite=25', 'cursor=a&cursor=b', 'cursor=alterado',
  'habilitada=0', 'habilitada=true&habilitada=false', 'clienteId=2147483648', 'cuentaId=1', 'rol=ADMIN']) {
  test(`query inválida con privacidad: ${query}`, () => expectCode(list + '?' + query, 400, 'CONSULTA_INVALIDA'));
}

test('lista solo cuentas existentes y aplica filtros combinados exactos', async () => {
  const all = await data(list);
  const ids = Object.values(fixture.accounts).map(a => a.clientId);
  assert.deepEqual(all.items.map(item => item.clienteId), ids);
  assert.equal(all.items[0].saldo, '225.00');
  const disabled = await data(list + '?habilitada=false');
  assert.deepEqual(disabled.items.map(item => item.clienteId), [account('disabled').clientId]);
  const enabled = await data(list + '?habilitada=true');
  assert.equal(enabled.items.length, ids.length - 1);
  const key = account('disabled').clientId;
  assert.deepEqual((await data(list + '?clienteId=' + key + '&habilitada=true')).items, []);
  assert.equal((await data(list + '?clienteId=' + key + '&habilitada=false')).items[0].estado, 'INHABILITADA');
  assert.deepEqual((await data(list + '?clienteId=1')).items, []);
});

test('fuera de test las cuentas DEMO quedan excluidas de listado y detalle', async () => {
  const previous = process.env.NODE_ENV;
  await session.connection.query('INSERT INTO CUENTA_CORRIENTE(id_cliente,limite_credito,habilitada) VALUES(3,500,1)');
  process.env.NODE_ENV = 'development';
  try {
    const visible = await data(list);
    assert.deepEqual(visible.items.map(({ clienteId, origen, saldo, limite }) => [clienteId, origen, saldo, limite]),
      [[3, 'REAL', null, null]]);
    assert.equal((await data(pathFor('debt'))).estado, 'SIN_CUENTA');
    assert.equal((await data(pathFor('debt', '/movimientos'))).estado, 'SIN_CUENTA');
  } finally {
    process.env.NODE_ENV = previous;
    await session.connection.query('DELETE FROM CUENTA_CORRIENTE WHERE id_cliente=3');
  }
});

test('páginas del listado recorren claves únicas y mantienen corte y revisión', async () => {
  const expected = Object.values(fixture.accounts).map(a => a.clientId);
  let next = list + '?limite=3';
  const first = await data(next);
  let current = first;
  const actual = [];
  for (const size of [3, 3, 2]) {
    assert.equal(current.items.length, size);
    assert.equal(current.corte, first.corte);
    assert.equal(current.revision, first.revision);
    actual.push(...current.items.map(item => item.clienteId));
    if (current.siguienteCursor) current = await data(next + '&' + cursorParam(current.siguienteCursor));
  }
  assert.equal(current.siguienteCursor, null);
  assert.deepEqual(actual, expected);
});

test('cursor autentica identidad, rol, ámbito, cliente y filtros, y expira', async () => {
  const first = await data(list + '?limite=1&habilitada=true');
  const token = first.siguienteCursor;
  const resume = list + '?limite=1&habilitada=true&';
  assert.ok(token);
  const altered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  await expectCode(resume + cursorParam(altered), 400, 'CONSULTA_INVALIDA');
  await expectCode(list + '?limite=1&' + cursorParam(token), 400, 'CONSULTA_INVALIDA');
  await expectCode(list + '?habilitada=false&' + cursorParam(token), 400, 'CONSULTA_INVALIDA');
  const result = await session.connection.query("INSERT INTO USUARIO(email,password_hash,rol,activo) VALUES('otro-admin@example.test','prueba','ADMIN',1)");
  const other = signToken({ id: Number(result.insertId), rol: 'ADMIN' });
  await expectCode(resume + cursorParam(token), 400, 'CONSULTA_INVALIDA', other);
  const mov = await data(pathFor('debt', '/movimientos?limite=1'));
  await expectCode(pathFor('long', '/movimientos?' + cursorParam(mov.siguienteCursor)), 400, 'CONSULTA_INVALIDA');
  await expectCode(pathFor('debt', '/vencimientos?' + cursorParam(mov.siguienteCursor)), 400, 'CONSULTA_INVALIDA');
  const own = await data('/cuenta-corriente/movimientos?limite=1', signToken({ id: account('debt').userId, rol: 'CLIENTE' }));
  assert.ok(own.siguienteCursor);
  await expectCode(pathFor('debt', '/movimientos?' + cursorParam(own.siguienteCursor)), 400, 'CONSULTA_INVALIDA');
  const corte = new Date(Date.now() - CURSOR_TTL_MS - 1000).toISOString();
  const expired = signCursor({ ...decodeSignedAccountCursor(token), corte, exp: Date.parse(corte) + CURSOR_TTL_MS });
  await expectCode(resume + cursorParam(expired), 409, 'CONSULTA_DESACTUALIZADA');
});

test('revisión detecta cambios financieros, alta y habilitación dentro del filtro', async () => {
  const enabled = list + '?limite=1&habilitada=true';
  const capture = async () => enabled + '&' + cursorParam((await data(enabled)).siguienteCursor);
  const financial = await capture();
  await session.connection.query('UPDATE CUENTA_CORRIENTE SET limite_credito=1001 WHERE id_cuenta_corriente=?', [account('debt').accountId]);
  try { await expectCode(financial, 409, 'CONSULTA_DESACTUALIZADA'); }
  finally { await session.connection.query('UPDATE CUENTA_CORRIENTE SET limite_credito=1000 WHERE id_cuenta_corriente=?', [account('debt').accountId]); }
  const membership = await capture();
  await session.connection.query('UPDATE CUENTA_CORRIENTE SET habilitada=1 WHERE id_cuenta_corriente=?', [account('disabled').accountId]);
  try { await expectCode(membership, 409, 'CONSULTA_DESACTUALIZADA'); }
  finally { await session.connection.query('UPDATE CUENTA_CORRIENTE SET habilitada=0 WHERE id_cuenta_corriente=?', [account('disabled').accountId]); }
  const addition = await capture();
  await session.connection.query('INSERT INTO CUENTA_CORRIENTE(id_cliente,limite_credito,habilitada) VALUES(3,500,1)');
  try { await expectCode(addition, 409, 'CONSULTA_DESACTUALIZADA'); }
  finally { await session.connection.query('DELETE FROM CUENTA_CORRIENTE WHERE id_cliente=3'); }
  const unrelated = await capture();
  await session.connection.query('UPDATE CUENTA_CORRIENTE SET limite_credito=1001 WHERE id_cuenta_corriente=?', [account('disabled').accountId]);
  try { await data(unrelated); }
  finally { await session.connection.query('UPDATE CUENTA_CORRIENTE SET limite_credito=1000 WHERE id_cuenta_corriente=?', [account('disabled').accountId]); }
});

for (const [key, saldo, limite, utilizado, disponible, cobertura, estado] of [
  ['debt', '225.00', '1000.00', '225.00', '775.00', 'COMPLETA', 'HABILITADA'],
  ['long', '500.00', '2000.00', '500.00', '1500.00', 'COMPLETA', 'HABILITADA'],
  ['favor', '-150.00', '100.00', '0.00', '100.00', 'COMPLETA', 'HABILITADA'],
  ['disabled', '70.00', '1000.00', '70.00', '0.00', 'COMPLETA', 'INHABILITADA'],
  ['empty', '0.00', '400.00', '0.00', '400.00', 'COMPLETA', 'HABILITADA'],
  ['zero', '0.00', '0.00', '0.00', '0.00', 'COMPLETA', 'HABILITADA'],
  ['partial', null, '1000.00', null, null, 'PARCIAL', 'HABILITADA'],
  ['unknown', null, null, null, null, 'NO_ACREDITADA', 'HABILITADA'],
]) {
  test(`resumen financiero ${key}`, async () => {
    const dto = await data(pathFor(key));
    assert.deepEqual([dto.saldo, dto.limite, dto.utilizado, dto.disponible, dto.cobertura, dto.estado],
      [saldo, limite, utilizado, disponible, cobertura, estado]);
    assert.equal(dto.origen, 'DEMO');
    assert.equal(dto.moneda, 'USD');
    assert.equal(dto.plazoDias, key === 'long' ? 60 : 30);
    assert.equal(dto.estadoCredito, disponible === null ? 'NO_DETERMINABLE' : disponible === '0.00' ? 'BLOQUEADO' : 'DISPONIBLE');
    if (saldo === null) assert.equal(dto.deudaVencidaTotal, null);
  });
}

test('movimientos paginados, empate de fecha, anulación, saldo resultante y propiedad', async () => {
  const expected = account('debt').movements;
  const path = pathFor('debt', '/movimientos?limite=2');
  const first = await data(path);
  const second = await data(path + '&' + cursorParam(first.siguienteCursor));
  const third = await data(path + '&' + cursorParam(second.siguienteCursor));
  const items = [...first.items, ...second.items, ...third.items];
  assert.deepEqual(items.map(item => Number(item.id)), [
    expected['void-payment'], expected.payment, expected.future, expected.today, expected.void, expected.paid,
  ]);
  assert.deepEqual(items.map(item => [item.tipo, item.estado, item.saldoResultante]), [
    ['ABONO', 'ANULADO', '225.00'], ['ABONO', 'VIGENTE', '225.00'],
    ['CARGO', 'VIGENTE', '350.00'], ['CARGO', 'VIGENTE', '300.00'],
    ['CARGO', 'ANULADO', '100.00'], ['CARGO', 'VIGENTE', '100.00'],
  ]);
  assert.equal(third.siguienteCursor, null);
  assert.equal(second.corte, first.corte);
  assert.equal(third.revision, (await data(pathFor('debt'))).revision);
  assert.ok(items.every(item => item.moneda === 'USD' && item.origen === 'DEMO' &&
    (item.tipo === 'CARGO' ? item.referencia.pedidoId > 0 : item.referencia.pagoId > 0)));
  assert.doesNotMatch(JSON.stringify(items), /observaciones|interno-fixture|huella|evidencia|password/i);
  assert.equal((await data(pathFor('disabled', '/movimientos'))).items[0].importe, '70.00');
  assert.equal((await data(pathFor('partial', '/movimientos'))).items[0].saldoResultante, null);
  assert.deepEqual((await data(pathFor('empty', '/movimientos'))).items, []);
});

test('vencimientos FIFO: fecha civil, vence hoy, remanente, plazo histórico y corte estable', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(fixture.cut) });
  const path = pathFor('debt', '/vencimientos?limite=1');
  const first = await data(path);
  const { movements } = account('debt');
  assert.deepEqual(first.items.map(d => [d.movimientoId, d.venceEl, d.plazoDias, d.pendiente, d.estado]),
    [[String(movements.today), '2026-03-03', 30, '175.00', 'POR_VENCER']]);
  const summary = await data(pathFor('debt'));
  assert.equal(summary.revision, first.revision);
  assert.deepEqual([summary.deudaVencidaTotal, summary.deudaVencida30Dias, summary.deudaVencida60Dias, summary.deudaPorVencerTotal],
    ['0.00', '0.00', '0.00', '225.00']);
  t.mock.timers.setTime(Date.parse(fixture.cut) + 12 * 60 * 60 * 1000);
  const second = await data(path + '&' + cursorParam(first.siguienteCursor));
  assert.equal(second.corte, first.corte);
  assert.equal(second.siguienteCursor, null);
  assert.deepEqual(second.items.map(d => [d.movimientoId, d.venceEl, d.pendiente, d.estado]),
    [[String(movements.future), '2026-04-01', '50.00', 'POR_VENCER']]);
  t.mock.timers.setTime(Date.parse('2026-04-02T02:59:59.000Z'));
  const beforeMidnight = await data(path);
  t.mock.timers.setTime(Date.parse('2026-04-02T03:00:00.000Z'));
  const preserved = await data(path + '&' + cursorParam(beforeMidnight.siguienteCursor));
  assert.equal(preserved.corte, beforeMidnight.corte);
  assert.equal(preserved.items[0].estado, 'POR_VENCER');
  assert.equal((await data(pathFor('debt', '/vencimientos'))).items[1].estado, 'VENCIDO');
  const long = (await data(pathFor('long', '/vencimientos'))).items[0];
  assert.deepEqual([long.venceEl, long.plazoDias, long.pendiente, long.estado], ['2026-03-01', 60, '500.00', 'VENCIDO']);
  await session.connection.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=30 WHERE id_cuenta_corriente=?', [account('long').accountId]);
  try { assert.equal((await data(pathFor('long', '/vencimientos'))).items[0].plazoDias, 60); }
  finally { await session.connection.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=60 WHERE id_cuenta_corriente=?', [account('long').accountId]); }
  const partial = (await data(pathFor('partial', '/vencimientos'))).items[0];
  assert.deepEqual([partial.pendiente, partial.estado], [null, 'NO_DETERMINABLE']);
  assert.deepEqual((await data(pathFor('favor', '/vencimientos'))).items, []);
});

test('lecturas dejan el ledger y sus revisiones intactos y cambios de #260 invalidan cursores', async () => {
  const revision = () => ledger.calcularEstadoCuenta(account('debt').accountId).then(r => r.revision);
  const before = await revision();
  const path = pathFor('debt', '/movimientos?limite=1');
  const first = await data(path);
  await data(pathFor('debt'));
  await data(pathFor('debt', '/vencimientos'));
  await data(list);
  assert.equal(await revision(), before);
  await ledger.anularMovimiento({
    id_cuenta_corriente: account('debt').accountId, id_movimiento_cuenta: account('debt').movements.payment,
    actor: '1', evento: 'cc258-revision', motivo: 'Prueba aislada de revisión',
  });
  await expectCode(path + '&' + cursorParam(first.siguienteCursor), 409, 'CONSULTA_DESACTUALIZADA');
});

test('CLIENTE conserva su cuenta propia y no eleva permisos mediante headers', async () => {
  const owner = signToken({ id: account('long').userId, rol: 'CLIENTE' });
  assert.equal((await data('/cuenta-corriente', owner)).saldo, '500.00');
  await expectCode('/cuenta-corriente?clienteId=' + account('debt').clientId, 400, 'CONSULTA_INVALIDA', owner);
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { Origin: 'http://browser.test', 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials.client) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const rejected = await fetch(base + list, { headers: { Cookie: cookie, rol: 'ADMIN', clienteId: '1' } });
  assert.equal(rejected.status, 403);
  assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://browser.test' } })).status, 200);
});

test('error SQL real sanitizado y consulta posterior recuperada', async () => {
  await assertOwned(session);
  await session.connection.query('RENAME TABLE MOVIMIENTO_CUENTA_CORRIENTE TO DEMO_LEDGER_UNAVAILABLE');
  try {
    const result = await request(pathFor('debt'));
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { message: 'No se pudo consultar la cuenta corriente.' });
  } finally { await session.connection.query('RENAME TABLE DEMO_LEDGER_UNAVAILABLE TO MOVIMIENTO_CUENTA_CORRIENTE'); }
  await data(pathFor('debt'));
});

test('un bloqueo real de MariaDB provoca 503 y permite reintentar', { timeout: 12000 }, async () => {
  await assertOwned(session);
  await session.connection.query('LOCK TABLES CUENTA_CORRIENTE WRITE');
  try {
    await expectCode(pathFor('debt'), 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE');
  } finally { await session.connection.query('UNLOCK TABLES'); }
  await data(pathFor('debt'));
});

for (const demoFirst of [false, true]) {
  test(`H04 protege todo el libro con el abono DEMO ${demoFirst ? 'primero' : 'en página 2'}`, async () => {
    const { mock } = require('node:test');
    const { lockAccountOrderContext } = require('../dist/repositories/accountOrderContext.repository');
    await assertOwned(session);
    const connection = session.connection;
    const insert = async (sql, args) => Number((await connection.query(sql, args)).insertId);
    const email = `h04-${demoFirst}@example.test`;
    const clientId = await insert(`INSERT INTO CLIENTE(tipo_cliente,nombre_razon_social,email,estado_aprobacion_empresa,es_fiel,activo)
      VALUES('EMPRESA','Fixture H04',?,'APROBADA',0,1)`, [email]);
    const userId = await insert(`INSERT INTO USUARIO(id_cliente,email,password_hash,rol,activo)
      VALUES(?,?,'fixture-no-login','CLIENTE',1)`, [clientId, email]);
    const accountId = await insert(`INSERT INTO CUENTA_CORRIENTE
      (id_cliente,limite_credito,habilitada,cobertura,plazo_dias,moneda_limite,evidencia_limite,evidencia_plazo,
       evidencia_cobertura,cobertura_desde_utc,origen_datos)
      VALUES(?,300,1,'COMPLETA',30,'USD','Límite fixture','Plazo fixture','Alta fixture','2025-01-01','REAL')`, [clientId]);
    const auth = { id: userId, rol: 'CLIENTE' };
    const token = signToken(auth);
    const own = '/cuenta-corriente';
    const adminList = list + '?clienteId=' + clientId;
    assert.equal((await data(own, token)).saldo, '0.00');
    const order = () => insert(`INSERT INTO PEDIDO(id_cliente,fecha,estado,modalidad_pago,subtotal,descuento,total,moneda_total,evidencia_total_usd)
      VALUES(?,'2026-03-01','CONFIRMADO','CUENTA_CORRIENTE',1,0,1,'USD','Total fixture')`, [clientId]);
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-01T12:00:00Z') });
    try {
      for (let i = 0; i < 26; i++) {
        await ledger.registrarCargoPorPedido({ id_cuenta_corriente: accountId, id_pedido: await order(), monto: '1.00' });
      }
    } finally { mock.timers.reset(); }
    const clean = await data(own, token);
    assert.deepEqual([clean.origen, clean.saldo, clean.disponible], ['REAL', '26.00', '274.00']);
    const firstClean = await data(own + '/movimientos', token);
    const firstAdminClean = await data(detail(clientId, '/movimientos'));
    const paidAt = demoFirst ? '2026-03-02 12:00:00' : '2026-02-01 12:00:00';
    const paymentId = await insert(`INSERT INTO PAGO(id_cuenta_corriente,fecha,monto,metodo_pago,estado,moneda,fecha_acreditacion_utc,evidencia_acreditacion)
      VALUES(?,?,6.25,'DEMO','ACREDITADO','USD',?,'Pago fixture')`, [accountId, paidAt, paidAt]);
    const demoId = await ledger.registrarAbonoPorPago({ id_cuenta_corriente: accountId, id_pago: paymentId, monto: '6.25', origen: 'DEMO' });
    const paths = ['', '/movimientos', '/vencimientos'];
    const environment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expectCode(own + '/movimientos?' + cursorParam(firstClean.siguienteCursor), 409, 'CONSULTA_DESACTUALIZADA', token);
      await expectCode(detail(clientId, '/movimientos?') + cursorParam(firstAdminClean.siguienteCursor), 409, 'CONSULTA_DESACTUALIZADA');
      for (const path of paths) {
        await expectCode(own + path, 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE', token);
        await expectCode(detail(clientId, path), 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE');
      }
      await expectCode(adminList, 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE');
      assert.equal((await data(own, client)).estado, 'SIN_CUENTA');
    } finally { process.env.NODE_ENV = environment; }
    await assert.rejects(db.inTransaction(manager => lockAccountOrderContext(manager, auth, clientId)),
      { code: 'CREDITO_NO_VERIFICADO' });
    await assert.rejects(ledger.registrarCargoPorPedido({ id_cuenta_corriente: accountId, id_pedido: await order(), monto: '1.00' }),
      /procedencia del libro/);
    const mixed = await data(own, token);
    assert.deepEqual([mixed.origen, mixed.saldo, mixed.disponible], ['DEMO', '19.75', '280.25']);
    const first = await data(own + '/movimientos', token);
    const nextPath = own + '/movimientos?' + cursorParam(first.siguienteCursor);
    const second = await data(nextPath, token);
    assert.equal(first.items.length, 25);
    assert.equal(second.items.length, 2);
    assert.equal(first.items.some(row => row.id === String(demoId)), demoFirst);
    assert.equal(second.items.some(row => row.id === String(demoId)), !demoFirst);
    assert.deepEqual([second.revision, second.corte], [first.revision, first.corte]);
    for (const row of [...first.items, ...second.items, ...(await data(own + '/vencimientos', token)).items]) {
      assert.equal(row.origen, 'DEMO');
    }
    assert.equal((await data(adminList)).items[0].origen, 'DEMO');
    process.env.NODE_ENV = 'production';
    try { await expectCode(nextPath, 503, 'CUENTA_CORRIENTE_NO_DISPONIBLE', token); }
    finally { process.env.NODE_ENV = environment; }
    await ledger.anularMovimiento({ id_cuenta_corriente: accountId, id_movimiento_cuenta: demoId, actor: '1',
      evento: `h04-void-${demoFirst}`, motivo: 'Conservar trazabilidad DEMO' });
    const voided = await data(own, token);
    assert.deepEqual([voided.origen, voided.saldo], ['DEMO', '26.00']);
    const history = await data(own + '/movimientos?limite=100', token);
    assert.equal(history.items.find(row => row.id === String(demoId)).estado, 'ANULADO');
    await expectCode(nextPath, 409, 'CONSULTA_DESACTUALIZADA', token);
  });
}
