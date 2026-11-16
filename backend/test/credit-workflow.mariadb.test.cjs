// T-S7-09.1 — Flujo completo de solicitud, aprobación, habilitación y límite.
// Requiere MariaDB 11.4 descartable preparada por
// test/helpers/run-credit-workflow-mariadb.cjs.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

// En Linux/WSL el binario nativo de sharp instalado para Windows no carga.
// Esta suite no procesa imágenes.
try {
  require('sharp');
} catch {
  const sharpPath = require.resolve('sharp');
  require.cache[sharpPath] = {
    id: sharpPath,
    filename: sharpPath,
    loaded: true,
    exports: Object.assign(
      () => ({ resize: () => ({}), webp: () => ({}), toBuffer: async () => Buffer.alloc(0),
        metadata: async () => ({ width: 100, height: 100 }) }),
      { resize: () => ({}), webp: () => ({}), toBuffer: async () => Buffer.alloc(0),
        metadata: async () => ({ width: 100, height: 100 }) },
    ),
  };
}

assert.equal(process.env.NODE_ENV, 'test');
assert.match(process.env.DB_NAME || '', /^credit_test_[a-f0-9]{32}$/);
assert.equal(process.env.DB_HOST, '127.0.0.1');

const { app } = require('../dist/app');
const db = require('../dist/config/database.config');
const { pool } = require('../dist/config/catalog-snapshot.config');
const { signToken } = require('../dist/services/token.service');
const ledger = require('../dist/repositories/cuentaCorriente.repository');

const state = {
  server: null,
  base: '',
  admin: null,
  admin2: null,
  approved: null,
  pending: null,
  rejected: null,
  particular: null,
  other: null,
  requestId: null,
  requestKey: null,
  accountId: null,
  cargoId: null,
  abonoId: null,
  movementSnapshot: '',
  imputationSnapshot: '',
};

const idem = () => randomUUID();
const ORIGIN = process.env.APP_PUBLIC_ORIGIN || 'http://browser.test';

async function api(path, options = {}) {
  const headers = { Origin: ORIGIN, Connection: 'close', ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Cookie = `jwt_token=${options.token}`;
  if (options.key) headers['Idempotency-Key'] = options.key;
  const response = await fetch(`${state.base}${path}`, {
    method: options.method || 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body, headers: response.headers };
}

async function createUser(rol, options = {}) {
  const email = `credit-${randomUUID()}@ferrepatagonia.test`;
  const password = randomUUID();
  let clientId = null;
  if (rol === 'CLIENTE') {
    const tipo = options.tipoCliente || 'EMPRESA';
    const result = await db.dataSource.query(
      `INSERT INTO CLIENTE
        (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [tipo, options.nombre || 'Empresa de prueba', email,
        tipo === 'EMPRESA' ? (options.estadoEmpresa || 'APROBADA') : null, options.activo ?? 1],
    );
    clientId = Number(result.insertId);
  }
  const inserted = await db.dataSource.query(
    'INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo) VALUES (?, ?, ?, ?, ?)',
    [clientId, email, await bcrypt.hash(password, 4), rol, options.activo ?? 1],
  );
  const id = Number(inserted.insertId);
  return {
    id,
    clientId,
    email,
    token: signToken({ id, rol }),
    setActive: value => db.dataSource.query(
      'UPDATE USUARIO SET activo = ? WHERE id_usuario = ?', [value ? 1 : 0, id],
    ),
  };
}

async function requestFor(user, amount = '1500.00', term = 30, key = idem()) {
  const response = await api('/cuenta-corriente/solicitudes', {
    method: 'POST', token: user.token, key,
    body: { montoSolicitado: amount, plazoDias: term, observaciones: 'Compra de insumos' },
  });
  return { ...response, key };
}

async function accountRow(clientId) {
  const [row] = await db.dataSource.query(
    'SELECT * FROM CUENTA_CORRIENTE WHERE id_cliente = ?', [clientId],
  );
  return row || null;
}

async function eventsFor(clientId) {
  return db.dataSource.query(
    `SELECT * FROM EVENTO_CREDITO WHERE id_cliente = ?
     ORDER BY id_evento_credito`, [clientId],
  );
}

async function snapshotLedger(accountId) {
  const movements = await db.dataSource.query(
    `SELECT id_movimiento_cuenta, tipo_movimiento, monto, estado, fecha_efectiva, vence_el,
      huella_registro, evidencia_origen
     FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?
     ORDER BY id_movimiento_cuenta`, [accountId],
  );
  const imputations = await db.dataSource.query(
    `SELECT id_imputacion, id_cargo, id_abono, monto_imputado, estado
     FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente = ?
     ORDER BY id_imputacion`, [accountId],
  );
  return {
    movements: JSON.stringify(movements),
    imputations: JSON.stringify(imputations),
    count: movements.length,
  };
}

before(async () => {
  await db.initializeDatabase();
  state.admin = await createUser('ADMIN');
  state.admin2 = await createUser('ADMIN');
  state.approved = await createUser('CLIENTE', { estadoEmpresa: 'APROBADA', nombre: 'Empresa Aprobada' });
  state.pending = await createUser('CLIENTE', { estadoEmpresa: 'PENDIENTE', nombre: 'Empresa Pendiente' });
  state.rejected = await createUser('CLIENTE', { estadoEmpresa: 'RECHAZADA', nombre: 'Empresa Rechazada' });
  state.particular = await createUser('CLIENTE', { tipoCliente: 'PARTICULAR', nombre: 'Particular' });
  state.other = await createUser('CLIENTE', { estadoEmpresa: 'APROBADA', nombre: 'Otra Empresa' });

  state.server = app.listen(0, '127.0.0.1');
  await once(state.server, 'listening');
  state.base = `http://127.0.0.1:${state.server.address().port}/api`;
});

after(async () => {
  try {
    if (state.server) await new Promise(resolve => state.server.close(resolve));
    if (db.dataSource.isInitialized) await db.dataSource.destroy();
  } finally {
    await pool.end();
    // No se eliminan filas: la base es descartable y tmpfs.
  }
});

test('S7-09.1 lista propia vacía y privacidad', async () => {
  const response = await api('/cuenta-corriente/solicitudes', { token: state.approved.token });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('vary'), /Cookie/i);
  assert.deepEqual(response.body.data.items, []);
});

test('S7-09.1 solicitud válida, reintento idempotente y duplicado pendiente', async () => {
  const first = await requestFor(state.approved, '1500.00', 30);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.solicitud.estado, 'PENDIENTE');
  assert.equal(first.body.data.solicitud.montoSolicitado, '1500.00');
  assert.equal(first.body.data.solicitud.plazoDias, 30);
  assert.equal(first.body.data.solicitud.limiteAutorizado, null);
  assert.equal(first.body.data.solicitud.evidenciaResolucion, undefined);
  state.requestId = first.body.data.solicitud.id;
  state.requestKey = first.key;

  const retry = await api('/cuenta-corriente/solicitudes', {
    method: 'POST', token: state.approved.token, key: first.key,
    body: { montoSolicitado: '1500.00', plazoDias: 30, observaciones: 'Compra de insumos' },
  });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.data.solicitud.id, state.requestId);

  const duplicate = await requestFor(state.approved, '2000.00', 60);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'SOLICITUD_PENDIENTE');
  assert.equal(duplicate.body.solicitudId, state.requestId);

  const rekeyed = await api('/cuenta-corriente/solicitudes', {
    method: 'POST', token: state.approved.token, key: first.key,
    body: { montoSolicitado: '9999.00', plazoDias: 60, observaciones: null },
  });
  assert.equal(rekeyed.status, 409);
  assert.equal(rekeyed.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  const events = await eventsFor(state.approved.clientId);
  assert.equal(events.filter(event => event.tipo_evento === 'SOLICITUD_CREADA').length, 1);
});

test('S7-09.1 PARTICULAR no puede solicitar ni elegir empresa', async () => {
  const response = await requestFor(state.particular);
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'SOLO_EMPRESAS');
  const [count] = await db.dataSource.query(
    'SELECT COUNT(*) AS c FROM SOLICITUD_CREDITO WHERE id_cliente = ?', [state.particular.clientId],
  );
  assert.equal(Number(count.c), 0);
});

test('S7-09.1 consulta propia y rechazo IDOR', async () => {
  const list = await api('/cuenta-corriente/solicitudes', { token: state.approved.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.items.length, 1);
  assert.equal(list.body.data.items[0].id, state.requestId);

  const own = await api(`/cuenta-corriente/solicitudes/${state.requestId}`, { token: state.approved.token });
  assert.equal(own.status, 200);
  assert.equal(own.body.data.solicitud.id, state.requestId);

  const foreign = await api(`/cuenta-corriente/solicitudes/${state.requestId}`, { token: state.other.token });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.code, 'SOLICITUD_NO_ENCONTRADA');
});

test('S7-09.1 permisos: CLIENTE no resuelve, ADMIN inactivo/degradado no opera', async () => {
  const asClient = await api(`/admin/solicitudes-credito/${state.requestId}/aprobar`, {
    method: 'POST', token: state.approved.token, key: idem(),
    body: { limiteAutorizado: '2000.00', plazoDias: 30, evidencia: 'ACTA', motivo: 'Aprobación' },
  });
  assert.equal(asClient.status, 403);

  const inactive = await createUser('ADMIN', { activo: 0 });
  const inactiveRes = await api(`/admin/solicitudes-credito/${state.requestId}/aprobar`, {
    method: 'POST', token: inactive.token, key: idem(),
    body: { limiteAutorizado: '2000.00', plazoDias: 30, evidencia: 'ACTA', motivo: 'Aprobación' },
  });
  assert.equal(inactiveRes.status, 401);

  const stale = await createUser('ADMIN');
  const staleClient = await db.dataSource.query(
    `INSERT INTO CLIENTE
      (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
     VALUES ('EMPRESA', 'Empresa degradada', ?, 'APROBADA', 0, 1)`,
    [`stale-${randomUUID()}@ferrepatagonia.test`],
  );
  await db.dataSource.query("UPDATE USUARIO SET rol = 'CLIENTE', id_cliente = ? WHERE id_usuario = ?",
    [Number(staleClient.insertId), stale.id]);
  const staleRes = await api(`/admin/solicitudes-credito/${state.requestId}/aprobar`, {
    method: 'POST', token: stale.token, key: idem(),
    body: { limiteAutorizado: '2000.00', plazoDias: 30, evidencia: 'ACTA', motivo: 'Aprobación' },
  });
  assert.equal(staleRes.status, 401);
});

test('S7-09.1 empresa pendiente o rechazada no obtiene cuenta ni crédito', async () => {
  for (const company of [state.pending, state.rejected]) {
    const request = await requestFor(company, '1000.00', 30);
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const requestId = request.body.data.solicitud.id;
    const approval = await api(`/admin/solicitudes-credito/${requestId}/aprobar`, {
      method: 'POST', token: state.admin.token, key: idem(),
      body: { limiteAutorizado: '1000.00', plazoDias: 30, evidencia: 'ACTA-EMPRESA', motivo: 'Alta' },
    });
    assert.equal(approval.status, 409, JSON.stringify(approval.body));
    assert.equal(approval.body.code, 'EMPRESA_NO_APROBADA');
    assert.equal(await accountRow(company.clientId), null);
    const [pending] = await db.dataSource.query(
      'SELECT estado FROM SOLICITUD_CREDITO WHERE id_solicitud_credito = ?', [requestId],
    );
    assert.equal(pending.estado, 'PENDIENTE');
    const failedEvents = (await eventsFor(company.clientId))
      .filter(item => item.id_solicitud_credito === requestId);
    assert.equal(failedEvents.length, 1, 'Solo debe existir el evento de creación');
    assert.equal(failedEvents[0].tipo_evento, 'SOLICITUD_CREADA');
    const enable = await api(`/admin/clientes/${company.clientId}/cuenta-corriente/habilitar`, {
      method: 'POST', token: state.admin.token, key: idem(), body: { evidencia: 'ACTA' },
    });
    assert.equal(enable.status, 404);
  }
});

test('S7-09.1 pasar a empresa APROBADA no habilita la cuenta por sí solo', async () => {
  const [request] = await db.dataSource.query(
    `SELECT id_solicitud_credito FROM SOLICITUD_CREDITO
     WHERE id_cliente = ? AND estado = 'PENDIENTE'`, [state.pending.clientId],
  );
  assert.ok(request);
  await db.dataSource.query(
    "UPDATE CLIENTE SET estado_aprobacion_empresa = 'APROBADA' WHERE id_cliente = ?",
    [state.pending.clientId],
  );
  const approval = await api(`/admin/solicitudes-credito/${request.id_solicitud_credito}/aprobar`, {
    method: 'POST', token: state.admin.token, key: idem(),
    body: { limiteAutorizado: '1000.00', plazoDias: 30, evidencia: 'ACTA-EMPRESA', motivo: 'Alta' },
  });
  assert.equal(approval.status, 200, JSON.stringify(approval.body));
  assert.equal(approval.body.data.cuenta.habilitada, false);
  const account = await accountRow(state.pending.clientId);
  assert.equal(Number(account.habilitada), 0);
  const current = await ledger.calcularEstadoCuenta(account.id_cuenta_corriente);
  assert.equal(current.habilitada, false);
  assert.equal(current.estado_credito, 'BLOQUEADO');
});

test('S7-09.1 aprobación crea cuenta inhabilitada con límite, plazo y evidencia', async () => {
  const key = idem();
  const approval = await api(`/admin/solicitudes-credito/${state.requestId}/aprobar`, {
    method: 'POST', token: state.admin.token, key,
    body: {
      limiteAutorizado: '2000.00', plazoDias: 30,
      evidencia: 'ACTA-CREDITO-2026-001', motivo: 'Aprobación comercial',
    },
  });
  assert.equal(approval.status, 200, JSON.stringify(approval.body));
  assert.equal(approval.body.data.solicitud.estado, 'APROBADA');
  assert.equal(approval.body.data.solicitud.limiteAutorizado, '2000.00');
  assert.equal(approval.body.data.cuenta.habilitada, false);
  assert.equal(approval.body.data.cuenta.limiteCredito, '2000.00');
  assert.equal(approval.body.data.cuenta.plazoDias, 30);
  assert.equal(approval.body.data.cuenta.cobertura, 'COMPLETA');
  state.accountId = approval.body.data.cuenta.cuentaId;

  const account = await accountRow(state.approved.clientId);
  assert.equal(Number(account.habilitada), 0);
  assert.equal(account.limite_credito, '2000.00');
  assert.equal(account.moneda_limite, 'USD');
  assert.ok(account.evidencia_limite);
  assert.equal(account.plazo_dias, 30);
  assert.ok(account.evidencia_plazo);
  assert.equal(account.cobertura, 'COMPLETA');
  assert.ok(account.evidencia_cobertura);
  assert.ok(account.cobertura_desde_utc);

  const events = await eventsFor(state.approved.clientId);
  const event = events.find(item => item.tipo_evento === 'SOLICITUD_APROBADA');
  assert.ok(event);
  assert.equal(event.id_actor_usuario, state.admin.id);
  assert.equal(event.rol_actor, 'ADMIN');
  assert.equal(event.estado_anterior, 'PENDIENTE');
  assert.equal(event.estado_nuevo, 'APROBADA');
  assert.equal(event.limite_anterior, null);
  assert.equal(event.limite_nuevo, '2000.00');
  assert.equal(event.evidencia, 'ACTA-CREDITO-2026-001');
  assert.ok(event.revision_cuenta);

  const retry = await api(`/admin/solicitudes-credito/${state.requestId}/aprobar`, {
    method: 'POST', token: state.admin.token, key,
    body: {
      limiteAutorizado: '2000.00', plazoDias: 30,
      evidencia: 'ACTA-CREDITO-2026-001', motivo: 'Aprobación comercial',
    },
  });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.meta.replay, true);

  const resolveAgain = await api(`/admin/solicitudes-credito/${state.requestId}/aprobar`, {
    method: 'POST', token: state.admin.token, key: idem(),
    body: {
      limiteAutorizado: '2000.00', plazoDias: 30,
      evidencia: 'ACTA-CREDITO-2026-001', motivo: 'Aprobación comercial',
    },
  });
  assert.equal(resolveAgain.status, 409);
  assert.equal(resolveAgain.body.code, 'SOLICITUD_NO_PENDIENTE');
});

test('S7-09.1 rechazo no crea cuenta y una rechazada no se aprueba después', async () => {
  const request = await requestFor(state.other, '800.00', 60);
  assert.equal(request.status, 201);
  const requestId = request.body.data.solicitud.id;

  const rejection = await api(`/admin/solicitudes-credito/${requestId}/rechazar`, {
    method: 'POST', token: state.admin.token, key: idem(),
    body: { motivo: 'Antecedentes comerciales insuficientes', evidencia: 'INFORME-COMERCIAL' },
  });
  assert.equal(rejection.status, 200, JSON.stringify(rejection.body));
  assert.equal(rejection.body.data.solicitud.estado, 'RECHAZADA');
  assert.equal(await accountRow(state.other.clientId), null);

  const approval = await api(`/admin/solicitudes-credito/${requestId}/aprobar`, {
    method: 'POST', token: state.admin.token, key: idem(),
    body: { limiteAutorizado: '900.00', plazoDias: 60, evidencia: 'ACTA', motivo: 'Reintento' },
  });
  assert.equal(approval.status, 409);
  assert.equal(approval.body.code, 'SOLICITUD_NO_PENDIENTE');

  const events = await eventsFor(state.other.clientId);
  const event = events.find(item => item.tipo_evento === 'SOLICITUD_RECHAZADA');
  assert.equal(event.estado_anterior, 'PENDIENTE');
  assert.equal(event.estado_nuevo, 'RECHAZADA');
  assert.equal(event.motivo, 'Antecedentes comerciales insuficientes');
});

test('S7-09.1 habilitación y deshabilitación inmediatas, idempotentes y auditadas', async () => {
  const enableKey = idem();
  const enable = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: enableKey,
    body: { evidencia: 'ACTA-HABILITACION', motivo: 'Alta operativa' },
  });
  assert.equal(enable.status, 200, JSON.stringify(enable.body));
  assert.equal(enable.body.data.cuenta.habilitada, true);

  const account = await accountRow(state.approved.clientId);
  assert.equal(Number(account.habilitada), 1);

  const stateAfterEnable = await ledger.calcularEstadoCuenta(state.accountId);
  assert.equal(stateAfterEnable.habilitada, true);
  assert.equal(stateAfterEnable.estado_credito, 'DISPONIBLE');
  assert.equal(stateAfterEnable.credito_disponible, '2000.00');

  const retry = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: enableKey,
    body: { evidencia: 'ACTA-HABILITACION', motivo: 'Alta operativa' },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.meta.replay, true);

  const already = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: idem(), body: { evidencia: 'ACTA-HABILITACION' },
  });
  assert.equal(already.status, 409);
  assert.equal(already.body.code, 'CUENTA_YA_HABILITADA');

  const disable = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/deshabilitar`, {
    method: 'POST', token: state.admin.token, key: idem(),
    body: { motivo: 'Revisión comercial', evidencia: 'ACTA-BAJA' },
  });
  assert.equal(disable.status, 200, JSON.stringify(disable.body));
  assert.equal(disable.body.data.cuenta.habilitada, false);
  assert.equal((await accountRow(state.approved.clientId)).id_cuenta_corriente, state.accountId);

  const stateAfterDisable = await ledger.calcularEstadoCuenta(state.accountId);
  assert.equal(stateAfterDisable.habilitada, false);
  assert.equal(stateAfterDisable.estado_credito, 'BLOQUEADO');
  assert.equal(stateAfterDisable.credito_disponible, '0.00');

  const events = await eventsFor(state.approved.clientId);
  assert.equal(events.filter(item => item.tipo_evento === 'CUENTA_HABILITADA').length, 1);
  assert.equal(events.filter(item => item.tipo_evento === 'CUENTA_DESHABILITADA').length, 1);
});

test('S7-09.1 compras y abonos respetan la habilitación y el límite', async () => {
  const enable = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: idem(), body: { evidencia: 'ACTA-REHABILITACION' },
  });
  assert.equal(enable.status, 200, JSON.stringify(enable.body));

  const order = await db.dataSource.query(
    `INSERT INTO PEDIDO
      (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
     VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', 500.00, 0.00, 500.00, 'USD', ?)`,
    [state.approved.clientId, `PEDIDO-TEST-${randomUUID()}`],
  );
  const orderId = Number(order.insertId);
  state.cargoId = await ledger.registrarCargoPorPedido({
    id_cuenta_corriente: state.accountId,
    id_pedido: orderId,
    monto: '500.00',
    moneda: 'USD',
  });

  const afterCharge = await ledger.calcularEstadoCuenta(state.accountId);
  assert.equal(afterCharge.utilizado, '500.00');
  assert.equal(afterCharge.credito_disponible, '1500.00');

  const payment = await db.dataSource.query(
    `INSERT INTO PAGO
      (id_cuenta_corriente, monto, metodo_pago, estado, moneda,
       fecha_acreditacion_utc, evidencia_acreditacion)
     VALUES (?, 100.00, 'TRANSFERENCIA', 'ACREDITADO', 'USD', NOW(3), ?)`,
    [state.accountId, `PAGO-TEST-${randomUUID()}`],
  );
  const paymentId = Number(payment.insertId);
  state.abonoId = await ledger.registrarAbonoPorPago({
    id_cuenta_corriente: state.accountId,
    id_pago: paymentId,
    monto: '100.00',
  });
  const afterPayment = await ledger.calcularEstadoCuenta(state.accountId);
  assert.equal(afterPayment.utilizado, '400.00');
  assert.equal(afterPayment.credito_disponible, '1600.00');

  const snapshot = await snapshotLedger(state.accountId);
  state.movementSnapshot = snapshot.movements;
  state.imputationSnapshot = snapshot.imputations;
  assert.equal(snapshot.count, 2);

  const disable = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/deshabilitar`, {
    method: 'POST', token: state.admin.token, key: idem(), body: { motivo: 'Prueba de bloqueo' },
  });
  assert.equal(disable.status, 200);

  const secondOrder = await db.dataSource.query(
    `INSERT INTO PEDIDO
      (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
     VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', 10.00, 0.00, 10.00, 'USD', ?)`,
    [state.approved.clientId, `PEDIDO-TEST-${randomUUID()}`],
  );
  await assert.rejects(
    () => ledger.registrarCargoPorPedido({
      id_cuenta_corriente: state.accountId,
      id_pedido: Number(secondOrder.insertId),
      monto: '10.00',
      moneda: 'USD',
    }),
    /no se encuentra habilitada/,
  );

  await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: idem(), body: { evidencia: 'ACTA-REHABILITACION-2' },
  });

  const [revisionBefore] = await db.dataSource.query(
    'SELECT CAST(revision AS CHAR) AS revision FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
    [state.accountId],
  );
  const limit = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/limite`, {
    method: 'PUT', token: state.admin.token, key: idem(),
    body: { limite: '2500.00', evidencia: 'ACTA-LIMITE-2500', motivo: 'Ampliación comercial' },
  });
  assert.equal(limit.status, 200, JSON.stringify(limit.body));
  const [revisionAfter] = await db.dataSource.query(
    'SELECT CAST(revision AS CHAR) AS revision FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
    [state.accountId],
  );
  assert.ok(BigInt(revisionAfter.revision) > BigInt(revisionBefore.revision),
    'El cambio de límite debe incrementar la revisión de cuenta');
  assert.equal(limit.body.data.cuenta.limiteCredito, '2500.00');
  assert.equal(limit.body.data.limiteAnterior, '2000.00');
  assert.equal(limit.body.data.limiteNuevo, '2500.00');

  const afterLimit = await ledger.calcularEstadoCuenta(state.accountId);
  assert.equal(afterLimit.limite_credito, '2500.00');
  assert.equal(afterLimit.utilizado, '400.00');
  assert.equal(afterLimit.credito_disponible, '2100.00');

  const preserved = await snapshotLedger(state.accountId);
  assert.equal(preserved.movements, state.movementSnapshot);
  assert.equal(preserved.imputations, state.imputationSnapshot);
});

test('S7-09.1 límites inválidos y reducción por debajo de la deuda se rechazan', async () => {
  for (const limite of ['-1.00', '1.234', '10000000000.00', '1e3', 100]) {
    const response = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/limite`, {
      method: 'PUT', token: state.admin.token, key: idem(),
      body: { limite, evidencia: 'ACTA', motivo: 'Prueba' },
    });
    assert.equal(response.status, 400, `${limite}: ${JSON.stringify(response.body)}`);
  }

  const before = await eventsFor(state.approved.clientId);
  const reduction = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/limite`, {
    method: 'PUT', token: state.admin.token, key: idem(),
    body: { limite: '300.00', evidencia: 'ACTA-REDUCCION', motivo: 'Reducción' },
  });
  assert.equal(reduction.status, 409);
  assert.equal(reduction.body.code, 'LIMITE_POR_DEBAJO_DE_DEUDA');
  assert.equal((await accountRow(state.approved.clientId)).limite_credito, '2500.00');
  const after = await eventsFor(state.approved.clientId);
  assert.equal(after.length, before.length);
});

test('S7-09.1 decisiones concurrentes y modificación concurrente de límite', async () => {
  const request = await requestFor(state.approved, '3000.00', 30);
  assert.equal(request.status, 201);
  const requestId = request.body.data.solicitud.id;

  const [a, b] = await Promise.all([
    api(`/admin/solicitudes-credito/${requestId}/aprobar`, {
      method: 'POST', token: state.admin.token, key: idem(),
      body: { limiteAutorizado: '3000.00', plazoDias: 30, evidencia: 'ACTA-CONC-A', motivo: 'A' },
    }),
    api(`/admin/solicitudes-credito/${requestId}/aprobar`, {
      method: 'POST', token: state.admin2.token, key: idem(),
      body: { limiteAutorizado: '3000.00', plazoDias: 30, evidencia: 'ACTA-CONC-B', motivo: 'B' },
    }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);

  const events = await eventsFor(state.approved.clientId);
  assert.equal(events.filter(item =>
    item.tipo_evento === 'SOLICITUD_APROBADA' && item.id_solicitud_credito === requestId).length, 1);

  const [c, d] = await Promise.all([
    api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/limite`, {
      method: 'PUT', token: state.admin.token, key: idem(),
      body: { limite: '3100.00', evidencia: 'ACTA-CONC-L1', motivo: 'L1' },
    }),
    api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/limite`, {
      method: 'PUT', token: state.admin2.token, key: idem(),
      body: { limite: '3200.00', evidencia: 'ACTA-CONC-L2', motivo: 'L2' },
    }),
  ]);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const finalLimit = (await accountRow(state.approved.clientId)).limite_credito;
  assert.ok(['3100.00', '3200.00'].includes(finalLimit));

  const [e, f] = await Promise.all([
    api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/deshabilitar`, {
      method: 'POST', token: state.admin.token, key: idem(), body: { motivo: 'Concurrente 1' },
    }),
    api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/deshabilitar`, {
      method: 'POST', token: state.admin2.token, key: idem(), body: { motivo: 'Concurrente 2' },
    }),
  ]);
  assert.deepEqual([e.status, f.status].sort(), [200, 409]);
  await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: idem(), body: { evidencia: 'ACTA-FINAL' },
  });
});

test('S7-09.1 aprobación y rechazo concurrentes no dejan estados parciales', async () => {
  const request = await requestFor(state.other, '700.00', 30);
  assert.equal(request.status, 201);
  const requestId = request.body.data.solicitud.id;

  const [approval, rejection] = await Promise.all([
    api(`/admin/solicitudes-credito/${requestId}/aprobar`, {
      method: 'POST', token: state.admin.token, key: idem(),
      body: { limiteAutorizado: '700.00', plazoDias: 30, evidencia: 'ACTA-CONC-AP', motivo: 'Aprobación' },
    }),
    api(`/admin/solicitudes-credito/${requestId}/rechazar`, {
      method: 'POST', token: state.admin2.token, key: idem(),
      body: { motivo: 'Rechazo concurrente' },
    }),
  ]);
  assert.deepEqual([approval.status, rejection.status].sort(), [200, 409]);

  const [row] = await db.dataSource.query(
    'SELECT estado, id_cuenta_corriente, limite_autorizado FROM SOLICITUD_CREDITO WHERE id_solicitud_credito = ?',
    [requestId],
  );
  assert.ok(['APROBADA', 'RECHAZADA'].includes(row.estado));
  if (row.estado === 'RECHAZADA') {
    assert.equal(row.id_cuenta_corriente, null);
    assert.equal(row.limite_autorizado, null);
  }
  const events = await eventsFor(state.other.clientId);
  assert.equal(events.filter(item => item.id_solicitud_credito === requestId
    && ['SOLICITUD_APROBADA', 'SOLICITUD_RECHAZADA'].includes(item.tipo_evento)).length, 1);
});

test('S7-09.1 auditoría reconstruible y sin datos internos para el cliente', async () => {
  const events = await api(`/admin/credito/eventos?clienteId=${state.approved.clientId}&limite=100`, {
    token: state.admin.token,
  });
  assert.equal(events.status, 200);
  assert.ok(events.body.data.items.length >= 6);
  for (const item of events.body.data.items) {
    assert.ok(item.actorUsuarioId > 0);
    assert.ok(item.fechaEvento.endsWith('Z'));
    assert.ok(item.tipo);
    assert.ok(item.estadoNuevo);
  }
  assert.ok(events.body.data.items.some(item => item.tipo === 'LIMITE_MODIFICADO'
    && item.limiteAnterior === '2000.00' && item.limiteNuevo === '2500.00'));

  const forbidden = await api(`/admin/credito/eventos?clienteId=${state.approved.clientId}`, {
    token: state.approved.token,
  });
  assert.equal(forbidden.status, 403);

  const own = await api(`/cuenta-corriente/solicitudes/${state.requestId}`, { token: state.approved.token });
  assert.equal(own.status, 200);
  const serialized = JSON.stringify(own.body);
  assert.doesNotMatch(serialized, /ACTA-CREDITO-2026-001|Aprobación comercial|id_actor_usuario/);
});

test('S7-09.1 persistencia tras reinicio del pool de datos', async () => {
  const requestId = state.requestId;
  const accountId = state.accountId;
  await new Promise(resolve => state.server.close(resolve));
  state.server = null;
  await db.dataSource.destroy();
  await db.initializeDatabase();
  const [request] = await db.dataSource.query(
    'SELECT estado, limite_autorizado FROM SOLICITUD_CREDITO WHERE id_solicitud_credito = ?', [requestId],
  );
  assert.equal(request.estado, 'APROBADA');
  assert.equal(request.limite_autorizado, '2000.00');
  const [account] = await db.dataSource.query(
    'SELECT habilitada FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [accountId],
  );
  assert.equal(Number(account.habilitada), 1);
  const [eventCount] = await db.dataSource.query(
    'SELECT COUNT(*) AS c FROM EVENTO_CREDITO WHERE id_cliente = ?', [state.approved.clientId],
  );
  assert.ok(Number(eventCount.c) >= 6);
});
