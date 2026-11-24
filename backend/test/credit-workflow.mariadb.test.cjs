// T-S7-09.1 — Flujo completo de solicitud, aprobación, habilitación y límite.
// Requiere MariaDB 11.4 descartable preparada por
// test/helpers/run-credit-workflow-mariadb.cjs.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
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
const { verifyProductPrice } = require('../dist/services/pricing/price-verification');

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

// Pause one real HTTP transaction after it acquires a lock. Release it only
// after MariaDB shows the competing locking read executing against that row.
async function overlapOnLock({ matches, waitingFor, hold, contend }) {
  const original = db.dataSource.createQueryRunner;
  const paused = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let matched = false;
  db.dataSource.createQueryRunner = function (...args) {
    const runner = original.apply(this, args);
    const query = runner.query.bind(runner);
    runner.query = async (sql, params, ...rest) => {
      const result = await query(sql, params, ...rest);
      if (!matched && runner.isTransactionActive && matches(sql, params)) {
        matched = true;
        const [{ id }] = await query('SELECT CONNECTION_ID() AS id');
        paused.resolve(id);
        await resume.promise;
      }
      return result;
    };
    return runner;
  };
  const requests = [];
  const track = promise => {
    requests.push(promise);
    promise.catch(() => {});
    return promise;
  };
  try {
    const holder = track(hold());
    const blocker = await Promise.race([
      paused.promise,
      holder.then(result => assert.fail(`La operación terminó antes del bloqueo: ${JSON.stringify(result)}`)),
    ]);
    let earlyResult;
    track(contend()).then(result => { earlyResult = result; }, () => {});
    const deadline = performance.now() + 1500;
    let waiting = false;
    do {
      // MariaDB 11.4 can wait for a const row during query optimization
      // (Statistics), before the wait is exposed in INNODB_LOCK_WAITS.
      const running = await pool.query(`
        SELECT INFO FROM information_schema.PROCESSLIST
        WHERE DB = DATABASE() AND ID NOT IN (?, CONNECTION_ID())
          AND COMMAND = 'Query' AND TIME_MS >= 100`, [blocker]);
      waiting = running.some(row => typeof row.INFO === 'string' && waitingFor.test(row.INFO));
      if (!waiting) await delay(50);
    } while (!waiting && !earlyResult && performance.now() < deadline);
    assert.ok(waiting, `MariaDB no mostró la lectura ${waitingFor} esperando por la sesión ${blocker}`);
  } finally {
    resume.resolve();
    db.dataSource.createQueryRunner = original;
    await Promise.allSettled(requests);
  }
  return Promise.all(requests);
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

test('S7-09.1 la clave de creación no revela una solicitud de la empresa anterior', async () => {
  const previous = await createUser('CLIENTE');
  const current = await createUser('CLIENTE');
  const created = await requestFor(previous);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await db.dataSource.query("UPDATE USUARIO SET rol = 'ADMIN', id_cliente = NULL WHERE id_usuario = ?", [current.id]);
  await db.dataSource.query('UPDATE USUARIO SET id_cliente = ? WHERE id_usuario = ?', [current.clientId, previous.id]);
  const retry = await requestFor(previous, '1500.00', 30, created.key);
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  assert.equal(retry.body.data, undefined);
  assert.deepEqual(await eventsFor(current.clientId), []);
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

test('S7-09.1 F-01/F-05 empresas pendientes o rechazadas no crean ni consultan solicitudes', async () => {
  for (const company of [state.pending, state.rejected]) {
    const request = await requestFor(company, '1000.00', 30);
    assert.equal(request.status, 403, JSON.stringify(request.body));
    assert.equal(request.body.code, 'EMPRESA_NO_APROBADA');
    assert.equal(request.body.meta, undefined);
    assert.deepEqual(await db.dataSource.query(
      'SELECT id_solicitud_credito FROM SOLICITUD_CREDITO WHERE id_cliente = ?', [company.clientId],
    ), []);
    assert.deepEqual(await eventsFor(company.clientId), []);
    assert.equal(await accountRow(company.clientId), null);
  }
  for (const [company, code] of [[state.pending, 'EMPRESA_NO_APROBADA'],
    [state.rejected, 'EMPRESA_NO_APROBADA'], [state.particular, 'SOLO_EMPRESAS']]) {
    for (const suffix of ['', `/${state.requestId}`]) {
      const result = await api(`/cuenta-corriente/solicitudes${suffix}`, { token: company.token });
      assert.equal(result.status, 403);
      assert.equal(result.body.code, code);
      assert.equal(result.body.data, undefined);
    }
  }
});

test('S7-09.1 F-01 revalida la empresa antes del replay y de la decisión administrativa', async () => {
  for (const estado of ['PENDIENTE', 'RECHAZADA']) {
    const company = await createUser('CLIENTE');
    const request = await requestFor(company, '1000.00', 30);
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const requestId = request.body.data.solicitud.id;
    await db.dataSource.query('UPDATE CLIENTE SET estado_aprobacion_empresa = ? WHERE id_cliente = ?',
      [estado, company.clientId]);
    const retry = await requestFor(company, '1000.00', 30, request.key);
    assert.equal(retry.status, 403);
    assert.equal(retry.body.code, 'EMPRESA_NO_APROBADA');
    assert.equal(retry.body.data, undefined);
    const detail = await api(`/cuenta-corriente/solicitudes/${requestId}`, { token: company.token });
    assert.equal(detail.status, 403);
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
    assert.equal((await eventsFor(company.clientId)).length, 1);
    assert.equal(failedEvents[0].tipo_evento, 'SOLICITUD_CREADA');
    const enable = await api(`/admin/clientes/${company.clientId}/cuenta-corriente/habilitar`, {
      method: 'POST', token: state.admin.token, key: idem(), body: { evidencia: 'ACTA' },
    });
    assert.equal(enable.status, 404);
  }
});

test('S7-09.1 pasar a empresa APROBADA no habilita la cuenta por sí solo', async () => {
  const forbidden = await requestFor(state.pending, '1000.00');
  assert.equal(forbidden.status, 403);
  const companyApproval = await api(`/admin/clientes/${state.pending.clientId}/estado-empresa`, {
    method: 'PATCH', token: state.admin.token, body: { estado: 'APROBADA' },
  });
  assert.equal(companyApproval.status, 200, JSON.stringify(companyApproval.body));
  assert.equal(await accountRow(state.pending.clientId), null);
  const request = await requestFor(state.pending, '1000.00', 30, forbidden.key);
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const approval = await api(`/admin/solicitudes-credito/${request.body.data.solicitud.id}/aprobar`, {
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

test('S7-09.1 F-02 DTO HTTP no convierte texto inválido en ausencia ni consume la clave', async () => {
  const company = await createUser('CLIENTE');
  const key = idem();
  const send = extra => api('/cuenta-corriente/solicitudes', {
    method: 'POST', token: company.token, key,
    body: { montoSolicitado: '750.00', plazoDias: 30, ...extra },
  });
  for (const observaciones of [12, false, '', '  \t']) {
    const invalid = await send({ observaciones });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body, { message: 'Las observaciones deben contener hasta 1000 caracteres.' });
  }
  assert.deepEqual(await db.dataSource.query(
    'SELECT id_solicitud_credito FROM SOLICITUD_CREDITO WHERE id_cliente = ?', [company.clientId],
  ), []);
  assert.deepEqual(await eventsFor(company.clientId), []);
  const accepted = await send({});
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.solicitud.observaciones, null);
});

test('S7-09.1 F-04 ADMIN no bloquea al solicitante histórico de otra empresa', async () => {
  const author = await createUser('CLIENTE');
  const current = await createUser('CLIENTE');
  const request = await requestFor(author);
  assert.equal(request.status, 201);
  await db.dataSource.query("UPDATE USUARIO SET rol = 'ADMIN', id_cliente = NULL WHERE id_usuario = ?",
    [current.id]);
  await db.dataSource.query('UPDATE USUARIO SET id_cliente = ? WHERE id_usuario = ?',
    [current.clientId, author.id]);

  const blocker = db.dataSource.createQueryRunner();
  try {
    await blocker.startTransaction('READ COMMITTED');
    await blocker.query('SELECT id_usuario FROM USUARIO WHERE id_usuario = ? FOR UPDATE', [author.id]);
    const resolved = await api(`/admin/solicitudes-credito/${request.body.data.solicitud.id}/rechazar`, {
      method: 'POST', token: state.admin.token, key: idem(), body: { motivo: 'Solicitud de relación anterior' },
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.equal(resolved.body.data.solicitud.estado, 'RECHAZADA');
    assert.deepEqual((await eventsFor(author.clientId)).map(event => event.tipo_evento),
      ['SOLICITUD_CREADA', 'SOLICITUD_RECHAZADA']);
    assert.deepEqual(await eventsFor(current.clientId), []);
  } finally {
    try {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    } finally {
      await blocker.release();
    }
  }
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

  const differentTerm = await api(`/admin/solicitudes-credito/${state.requestId}/aprobar`, {
    method: 'POST', token: state.admin.token, key,
    body: { limiteAutorizado: '2000.00', plazoDias: 60,
      evidencia: 'ACTA-CREDITO-2026-001', motivo: 'Aprobación comercial' },
  });
  assert.equal(differentTerm.status, 409, JSON.stringify(differentTerm.body));
  assert.equal(differentTerm.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

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

test('S7-09.1 rechazar con la misma clave y distinta evidencia devuelve 409', async () => {
  const company = await createUser('CLIENTE');
  const request = await requestFor(company);
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const reject = (key, body) => api(`/admin/solicitudes-credito/${request.body.data.solicitud.id}/rechazar`, {
    method: 'POST', token: state.admin.token, key, body,
  });
  const key = idem();
  const original = await reject(key, { motivo: 'Rechazo auditado' });
  assert.equal(original.status, 200, JSON.stringify(original.body));
  const retry = await reject(key, { motivo: 'Rechazo auditado' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.meta.replay, true);
  const changed = await reject(key, { motivo: 'Rechazo auditado', evidencia: 'ACTA NUEVA' });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  assert.deepEqual((await eventsFor(company.clientId)).map(event => event.tipo_evento),
    ['SOLICITUD_CREADA', 'SOLICITUD_RECHAZADA']);
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

  const changedReason = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: enableKey,
    body: { evidencia: 'ACTA-HABILITACION' },
  });
  assert.equal(changedReason.status, 409);
  assert.equal(changedReason.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  const already = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: idem(), body: { evidencia: 'ACTA-HABILITACION' },
  });
  assert.equal(already.status, 409);
  assert.equal(already.body.code, 'CUENTA_YA_HABILITADA');

  const disableKey = idem();
  const disable = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/deshabilitar`, {
    method: 'POST', token: state.admin.token, key: disableKey,
    body: { motivo: 'Revisión comercial', evidencia: 'ACTA-BAJA' },
  });
  assert.equal(disable.status, 200, JSON.stringify(disable.body));
  assert.equal(disable.body.data.cuenta.habilitada, false);
  assert.equal((await accountRow(state.approved.clientId)).id_cuenta_corriente, state.accountId);

  const changedEvidence = await api(`/admin/clientes/${state.approved.clientId}/cuenta-corriente/deshabilitar`, {
    method: 'POST', token: state.admin.token, key: disableKey,
    body: { motivo: 'Revisión comercial' },
  });
  assert.equal(changedEvidence.status, 409);
  assert.equal(changedEvidence.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

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

test('S7-09.1 F-03 el límite sin cambios registra la operación sin alterar cuenta ni libro', async () => {
  const clientId = state.approved.clientId;
  const account = await accountRow(clientId);
  const financial = await snapshotLedger(account.id_cuenta_corriente);
  assert.ok(financial.count > 0, 'La prueba debe preservar movimientos reales del fixture');
  const beforeEvents = await eventsFor(clientId);
  const key = idem();
  const body = { limite: account.limite_credito, evidencia: 'ACTA-SIN-CAMBIOS', motivo: 'Ratificación' };
  const send = patch => api(`/admin/clientes/${clientId}/cuenta-corriente/limite`, {
    method: 'PUT', token: state.admin.token, key, body: { ...body, ...patch },
  });
  const first = await send();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.sinCambios, true);
  assert.equal(first.body.data.limiteAnterior, account.limite_credito);
  assert.equal(first.body.data.limiteNuevo, account.limite_credito);
  assert.equal(first.body.meta.replay, false);

  const replay = await send();
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, {
    data: first.body.data, meta: { eventoId: first.body.meta.eventoId, replay: true },
  });
  for (const changed of [{ limite: '9000.00' }, { motivo: 'Otro motivo' }, { evidencia: 'Otra evidencia' }]) {
    const conflict = await send(changed);
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.equal(conflict.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  }
  const afterEvents = await eventsFor(clientId);
  assert.deepEqual(afterEvents.slice(0, -1), beforeEvents);
  const event = afterEvents.at(-1);
  assert.equal(String(event.id_evento_credito), first.body.meta.eventoId);
  assert.equal(event.clave_idempotencia, key);
  assert.equal(event.tipo_evento, 'LIMITE_MODIFICADO');
  assert.equal(event.limite_anterior, account.limite_credito);
  assert.equal(event.limite_nuevo, account.limite_credito);
  assert.equal(String(event.revision_cuenta), first.body.data.cuenta.revision);
  assert.deepEqual(await accountRow(clientId), account);
  assert.deepEqual(await snapshotLedger(account.id_cuenta_corriente), financial);
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
  const filtered = await api(`/admin/credito/eventos?clienteId=${state.approved.clientId}&tipo=LIMITE_MODIFICADO`, {
    token: state.admin.token,
  });
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.data.items.length > 0);
  assert.ok(filtered.body.data.items.every(item => item.tipo === 'LIMITE_MODIFICADO'));
  const invalidType = await api('/admin/credito/eventos?tipo=EVENTO_AJENO', { token: state.admin.token });
  assert.equal(invalidType.status, 400);
  assert.equal(invalidType.body.code, 'SOLICITUD_INVALIDA');

  const forbidden = await api(`/admin/credito/eventos?clienteId=${state.approved.clientId}`, {
    token: state.approved.token,
  });
  assert.equal(forbidden.status, 403);

  const own = await api(`/cuenta-corriente/solicitudes/${state.requestId}`, { token: state.approved.token });
  assert.equal(own.status, 200);
  const serialized = JSON.stringify(own.body);
  assert.doesNotMatch(serialized, /ACTA-CREDITO-2026-001|Aprobación comercial|id_actor_usuario/);
});

test('S7-09.1 checkout exige cuenta habilitada, empresa aprobada y precio FER-17 verificado', async () => {
  const company = await createUser('CLIENTE', { estadoEmpresa: 'PENDIENTE' });
  const companyPath = `/admin/clientes/${company.clientId}`;
  const admin = (path, body, method = 'POST') => api(path, {
    method, token: state.admin.token, key: idem(), body,
  });
  const setCompany = estado => admin(`${companyPath}/estado-empresa`, { estado }, 'PATCH');
  assert.equal((await setCompany('APROBADA')).status, 200);
  const request = await requestFor(company);
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const resolutionPath = `/admin/solicitudes-credito/${request.body.data.solicitud.id}/aprobar`;
  const approved = await admin(resolutionPath, { limiteAutorizado: '500.00', plazoDias: 30,
    evidencia: 'ACTA-CREDITO-7841', motivo: 'Crédito operativo' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const accountId = approved.body.data.cuenta.cuentaId;
  assert.equal(approved.body.data.cuenta.habilitada, false);
  const retry = await requestFor(company, '1500.00', 30, request.key);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.data, request.body.data, 'la creación devuelve su resultado persistido');
  assert.equal(retry.body.meta.eventoId, request.body.meta.eventoId);

  const category = await db.dataSource.query("INSERT INTO CATEGORIA (nombre, activo) VALUES ('Crédito FER-17', 1)");
  const product = await db.dataSource.query(`
    INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo)
    VALUES (?, 'CREDITO-FER17', 'Producto de crédito', 100.00, 10, 1)
  `, [Number(category.insertId)]);
  const productId = Number(product.insertId);
  const cart = await db.dataSource.query('INSERT INTO CARRITO (id_cliente) VALUES (?)', [company.clientId]);
  await db.dataSource.query('INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, ?, 1)',
    [Number(cart.insertId), productId]);
  const quote = () => api('/pedidos/cuenta-corriente/eligibilidad', { token: company.token });
  const checkout = cotizacion => api('/pedidos/cuenta-corriente', {
    method: 'POST', token: company.token, key: idem(), body: { cotizacion },
  });
  assert.equal((await quote()).body.data.codigo, 'CUENTA_NO_HABILITADA');
  const enabled = await admin(`${companyPath}/cuenta-corriente/habilitar`, { evidencia: 'ACTA-HABILITACION-7841' });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  const noPrice = await quote();
  assert.equal(noPrice.body.data.elegible, false);
  assert.equal(noPrice.body.data.cotizacion, null);

  const verify = expectedPrice => verifyProductPrice({ productId, expectedPrice,
    evidence: 'FACTURA-COMERCIAL-7841', adminId: state.admin.id, confirmed: true });
  assert.equal((await verify('100.00')).ok, true);
  const valid = await quote();
  assert.equal(valid.body.data.elegible, true, JSON.stringify(valid.body));
  for (const estado of ['PENDIENTE', 'RECHAZADA']) {
    assert.equal((await setCompany(estado)).status, 200);
    const rejected = await checkout(valid.body.data.cotizacion);
    assert.equal(rejected.status, 403, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'EMPRESA_NO_HABILITADA');
    assert.equal(Number((await accountRow(company.clientId)).habilitada), 1);
  }
  assert.equal((await setCompany('APROBADA')).status, 200);
  await db.dataSource.query('UPDATE PRODUCTO SET precio = 120.00 WHERE id_producto = ?', [productId]);
  assert.equal((await quote()).body.data.elegible, false);
  assert.equal((await snapshotLedger(accountId)).count, 0);
  assert.equal((await verify('120.00')).ok, true);
  const newPrice = await quote();
  assert.equal(newPrice.body.data.totalUSD, '120.00');
  const [newRequest, concurrentQuote] = await overlapOnLock({
    matches: (sql, params) => /estado_aprobacion_empresa, activo\s+FROM CLIENTE WHERE id_cliente = \? FOR UPDATE/.test(sql)
      && params[0] === company.clientId,
    waitingFor: /(?:FROM|JOIN) CLIENTE\b[\s\S]*FOR UPDATE/,
    hold: () => requestFor(company, '1250.00'),
    contend: quote,
  });
  assert.equal(newRequest.status, 201, JSON.stringify(newRequest.body));
  assert.equal(concurrentQuote.status, 200);
  assert.equal(concurrentQuote.body.data.elegible, true, JSON.stringify(concurrentQuote.body));
  const confirmed = await checkout(concurrentQuote.body.data.cotizacion);
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
  assert.equal((await snapshotLedger(accountId)).count, 1);
  assert.equal((await ledger.calcularEstadoCuenta(accountId)).credito_disponible, '380.00');

  const [adminLimit, checkoutQuote] = await overlapOnLock({
    matches: (sql, params) => /FROM CUENTA_CORRIENTE c\s+WHERE c.id_cliente = \? FOR UPDATE/.test(sql)
      && params[0] === company.clientId,
    waitingFor: /FROM CUENTA_CORRIENTE\s+WHERE id_cliente = \d+\s+FOR UPDATE/,
    hold: () => admin(`${companyPath}/cuenta-corriente/limite`, {
      limite: '550.00', evidencia: 'ACTA-550', motivo: 'Ampliación',
    }, 'PUT'),
    contend: quote,
  });
  assert.equal(adminLimit.status, 200, JSON.stringify(adminLimit.body));
  assert.equal(checkoutQuote.status, 200);
  // La compra anterior vació el carrito; la cotización no debe fallar por un lock.
  assert.equal(checkoutQuote.body.data.codigo, 'CARRITO_VACIO');
  assert.equal((await ledger.calcularEstadoCuenta(accountId)).credito_disponible, '430.00');
});

test('S7-09.1 panel administrativo: empresas, solicitudes, cuentas, filtros y paginación', async () => {
  const token = randomUUID().replaceAll('-', '').slice(0, 10);
  const companies = [];
  async function company(suffix) {
    const user = await createUser('CLIENTE', {
      estadoEmpresa: 'APROBADA',
      nombre: `Empresa ${token} ${suffix}`,
    });
    await db.dataSource.query(
      'UPDATE CLIENTE SET cuit = ? WHERE id_cliente = ?',
      [`30-${token.slice(0, 8)}-${companies.length + 1}`, user.clientId],
    );
    companies.push(user);
    return user;
  }
  async function decide(path, body) {
    return api(path, {
      method: 'POST', token: state.admin.token, key: idem(), body,
    });
  }
  async function createRequest(user) {
    const created = await requestFor(user, '800.00', 30);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body.data.solicitud.id;
  }

  const withoutAccount = await company('Sin Cuenta');
  const withPending = await company('Pendiente');
  const withRejected = await company('Rechazada');
  const withApproved = await company('Aprobada');
  const withEnabled = await company('Habilitada');

  const pendingId = await createRequest(withPending);
  const rejectedId = await createRequest(withRejected);
  const rejected = await decide(`/admin/solicitudes-credito/${rejectedId}/rechazar`, {
    motivo: 'Antecedentes comerciales insuficientes',
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));

  const approvedId = await createRequest(withApproved);
  const approved = await decide(`/admin/solicitudes-credito/${approvedId}/aprobar`, {
    limiteAutorizado: '700.00', plazoDias: 30,
    evidencia: `ACTA-${token}`, motivo: 'Aprobación de prueba',
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.cuenta.habilitada, false);

  const enabledId = await createRequest(withEnabled);
  await decide(`/admin/solicitudes-credito/${enabledId}/aprobar`, {
    limiteAutorizado: '900.00', plazoDias: 60,
    evidencia: `ACTA-${token}`, motivo: 'Aprobación de prueba',
  });
  const enabled = await api(`/admin/clientes/${withEnabled.clientId}/cuenta-corriente/habilitar`, {
    method: 'POST', token: state.admin.token, key: idem(),
    body: { evidencia: `ACTA-HABILITACION-${token}` },
  });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));

  const list = async query => {
    const response = await api(`/admin/credito/empresas?${query}`, { token: state.admin.token });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
    assert.match(response.headers.get('vary') ?? '', /Cookie/i);
    return response.body.data;
  };
  const search = `busqueda=${encodeURIComponent(token)}&limit=50`;
  const all = await list(search);
  assert.equal(all.paginacion.total, 5, JSON.stringify(all));
  const byId = new Map(all.empresas.map(item => [item.clienteId, item]));
  assert.equal(byId.get(withoutAccount.clientId).cuentaCorriente, null);
  assert.equal(byId.get(withoutAccount.clientId).solicitudCredito, null);
  assert.equal(byId.get(withPending.clientId).solicitudCredito.estado, 'PENDIENTE');
  assert.equal(byId.get(withPending.clientId).cuentaCorriente, null);
  assert.equal(byId.get(withRejected.clientId).solicitudCredito.estado, 'RECHAZADA');
  assert.equal(byId.get(withApproved.clientId).cuentaCorriente.estado, 'INHABILITADA');
  assert.equal(byId.get(withApproved.clientId).cuentaCorriente.limite, '700.00');
  assert.equal(byId.get(withEnabled.clientId).cuentaCorriente.estado, 'HABILITADA');
  assert.equal(byId.get(withEnabled.clientId).cuentaCorriente.plazoDias, 60);

  assert.deepEqual((await list(`${search}&estadoSolicitud=PENDIENTE`)).empresas.map(e => e.clienteId),
    [withPending.clientId]);
  assert.deepEqual((await list(`${search}&estadoSolicitud=SIN_SOLICITUD`)).empresas.map(e => e.clienteId),
    [withoutAccount.clientId]);
  assert.deepEqual((await list(`${search}&cuenta=INHABILITADA`)).empresas.map(e => e.clienteId),
    [withApproved.clientId]);
  assert.deepEqual((await list(`${search}&cuenta=HABILITADA`)).empresas.map(e => e.clienteId),
    [withEnabled.clientId]);
  assert.deepEqual((await list(`${search}&cuenta=SIN_CUENTA`)).empresas.map(e => e.clienteId).sort((a, b) => a - b),
    [withoutAccount.clientId, withPending.clientId, withRejected.clientId].sort((a, b) => a - b));
  assert.deepEqual((await list(`${search}&estadoSolicitud=RECHAZADA&cuenta=SIN_CUENTA`)).empresas
    .map(e => e.clienteId), [withRejected.clientId]);

  const cuit = `30-${token.slice(0, 8)}-4`;
  assert.deepEqual((await list(`busqueda=${encodeURIComponent(cuit)}`)).empresas.map(e => e.clienteId),
    [withApproved.clientId]);
  assert.deepEqual((await list(`busqueda=${encodeURIComponent(withEnabled.email)}`)).empresas
    .map(e => e.clienteId), [withEnabled.clientId]);
  assert.deepEqual((await list(`busqueda=${encodeURIComponent('#' + withRejected.clientId)}`)).empresas
    .map(e => e.clienteId), [withRejected.clientId]);

  const firstPage = await list(`busqueda=${encodeURIComponent(token)}&limit=2&page=1`);
  assert.equal(firstPage.paginacion.total, 5);
  assert.equal(firstPage.paginacion.totalPages, 3);
  assert.equal(firstPage.empresas.length, 2);
  const secondPage = await list(`busqueda=${encodeURIComponent(token)}&limit=2&page=2`);
  assert.equal(secondPage.empresas.length, 2);
  assert.deepEqual(secondPage.paginacion, { page: 2, limit: 2, total: 5, totalPages: 3 });
  const thirdPage = await list(`busqueda=${encodeURIComponent(token)}&limit=2&page=3`);
  assert.equal(thirdPage.empresas.length, 1);
  assert.deepEqual(
    [...firstPage.empresas, ...secondPage.empresas, ...thirdPage.empresas].map(e => e.clienteId),
    all.empresas.map(e => e.clienteId),
  );
  const clamped = await list(`busqueda=${encodeURIComponent(token)}&limit=2&page=99`);
  assert.equal(clamped.paginacion.page, 3);
  assert.equal(clamped.empresas.length, 1);

  const detail = await api(`/admin/credito/empresas/${withEnabled.clientId}`, {
    token: state.admin.token,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.empresa.nombreRazonSocial, `Empresa ${token} Habilitada`);
  assert.equal(detail.body.data.empresa.cuentaCorriente.estado, 'HABILITADA');

  const missing = await api('/admin/credito/empresas/2147483647', { token: state.admin.token });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'CLIENTE_NO_ENCONTRADO');
  const asClient = await api('/admin/credito/empresas', { token: withPending.token });
  assert.equal(asClient.status, 403);
  const anonymous = await api('/admin/credito/empresas');
  assert.equal(anonymous.status, 401);
  for (const query of ['page=0', 'limit=101', 'estadoSolicitud=OTRA', 'cuenta=SI', 'tipo=EMPRESA',
    'page=1&page=2']) {
    const invalid = await api(`/admin/credito/empresas?${query}`, { token: state.admin.token });
    assert.equal(invalid.status, 400, query);
    assert.equal(invalid.body.code, 'SOLICITUD_INVALIDA');
  }
  assert.equal((await api(`/admin/credito/empresas/${withRejected.clientId}`, {
    token: withRejected.token,
  })).status, 403);

  // Un libro DEMO no se presenta como cuenta real fuera del perfil de pruebas.
  const demo = await company('Demo');
  await db.dataSource.query(`INSERT INTO CUENTA_CORRIENTE
    (id_cliente, limite_credito, habilitada, cobertura, plazo_dias, moneda_limite,
     evidencia_limite, evidencia_plazo, evidencia_cobertura, cobertura_desde_utc, origen_datos)
    VALUES (?, 100.00, 1, 'COMPLETA', 30, 'USD', 'DEMO', 'DEMO', 'DEMO', UTC_TIMESTAMP(3), 'DEMO')`,
  [demo.clientId]);
  const demoToken = `busqueda=${encodeURIComponent('Empresa ' + token + ' Demo')}`;
  assert.equal((await list(demoToken)).empresas[0].cuentaCorriente.estado, 'HABILITADA');
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const hidden = await list(demoToken);
    assert.equal(hidden.empresas[0].cuentaCorriente, null);
    assert.deepEqual((await list(`${demoToken}&cuenta=SIN_CUENTA`)).empresas.map(e => e.clienteId),
      [demo.clientId]);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
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
