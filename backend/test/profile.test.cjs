const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_NAME: 'profile_test', DB_USER: 'test', DB_PASSWORD: 'test' });

const pool = require('./helpers/query-probe.cjs');
const { app } = require('../dist/app');
const service = require('../dist/services/perfil.service');
const { signToken } = require('../dist/services/token.service');
const jwt = require('jsonwebtoken');

let server;
let base;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/perfil`;
});

after(async () => { await new Promise(resolve => server.close(resolve)); });

const sessionRow = (id, rol = 'CLIENTE', tipo = 'PARTICULAR') => ({
  id_usuario: id,
  email: `usuario-${id}@example.test`,
  rol,
  activo: 1,
  nombre_razon_social: rol === 'ADMIN' ? null : `Cliente ${id}`,
  tipo_cliente: rol === 'ADMIN' ? null : tipo,
  estado_aprobacion_empresa: tipo === 'EMPRESA' ? 'PENDIENTE' : null,
});

function mockSessions(t, rows = [sessionRow(12), sessionRow(99, 'CLIENTE', 'EMPRESA'), sessionRow(7, 'ADMIN')]) {
  const byId = new Map(rows.map(row => [row.id_usuario, row]));
  t.mock.method(pool, 'query', async (sql, values) => {
    assert.match(sql, /LEFT JOIN `CLIENTE`/);
    assert.doesNotMatch(sql, /password_hash|SELECT\s+\*/i);
    assert.equal(values.length, 1);
    return [byId.get(Number(values[0]))];
  });
}

const request = (method, token, body, url = base) => fetch(url, {
  method,
  headers: {
    ...(token ? { Cookie: `jwt_token=${token}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const perfilParticular = {
  id: 12,
  tipoCliente: 'PARTICULAR',
  nombreRazonSocial: 'Cliente 12',
  email: 'cliente-12@example.test',
  docCliente: '30111222',
  cuit: null,
  telefono: '294 400 0000',
  direccion: 'Ruta 40 km 1',
  estadoAprobacionEmpresa: null,
  cuentaCorrienteHabilitada: null,
};

const perfilEmpresa = {
  ...perfilParticular,
  id: 99,
  tipoCliente: 'EMPRESA',
  nombreRazonSocial: 'Empresa 99 S.R.L.',
  email: 'empresa-99@example.test',
  docCliente: null,
  cuit: '30-71234567-8',
  estadoAprobacionEmpresa: 'PENDIENTE',
  cuentaCorrienteHabilitada: false,
};

test('sin cookie: 401 sin consultar la base', async t => {
  t.mock.method(pool, 'query', () => assert.fail('No debe consultar la base sin sesión'));
  const response = await request('GET', null);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { message: 'No autenticado.' });
});

for (const [label, token] of [
  ['JWT inválido', 'no-es-un-jwt'],
  ['JWT expirado', jwt.sign({ id: 12, rol: 'CLIENTE' }, process.env.JWT_SECRET, { expiresIn: -1 })],
]) {
  test(`${label}: 401 sin consultar la base`, async t => {
    t.mock.method(pool, 'query', () => assert.fail('No debe consultar la base con token inválido'));
    const response = await request('GET', token);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: 'No autenticado.' });
  });
}

test('ADMIN: 403 y no accede al perfil de cliente', async t => {
  mockSessions(t);
  t.mock.method(service, 'getPerfil', () => assert.fail('ADMIN no debe ejecutar el servicio de perfil'));
  const response = await request('GET', signToken({ id: 7, rol: 'ADMIN' }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: 'El rol autenticado no tiene permiso.' });
});

test('GET PARTICULAR: contrato propio, cache privada y sin campos sensibles', async t => {
  mockSessions(t);
  t.mock.method(service, 'getPerfil', async id => {
    assert.equal(id, 12);
    return perfilParticular;
  });
  const response = await request('GET', signToken({ id: 12, rol: 'CLIENTE' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('vary'), /Cookie/i);
  const body = await response.json();
  assert.deepEqual(body, { data: { perfil: perfilParticular } });
  const serialized = JSON.stringify(body);
  for (const forbidden of ['password', 'password_hash', 'token', 'jwt', 'activo', 'es_fiel']) {
    assert.ok(!serialized.includes(forbidden), `No debe exponer ${forbidden}`);
  }
});

test('GET EMPRESA: distingue tipo y estado comercial de solo lectura', async t => {
  mockSessions(t);
  t.mock.method(service, 'getPerfil', async id => {
    assert.equal(id, 99);
    return perfilEmpresa;
  });
  const response = await request('GET', signToken({ id: 99, rol: 'CLIENTE' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { perfil: perfilEmpresa } });
});

test('GET ignora IDs de query y resuelve la identidad solo desde la sesión', async t => {
  mockSessions(t);
  t.mock.method(service, 'getPerfil', async id => {
    assert.equal(id, 12);
    return perfilParticular;
  });
  const response = await request('GET', signToken({ id: 12, rol: 'CLIENTE' }), undefined,
    `${base}?id_usuario=99&id_cliente=99`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { perfil: perfilParticular } });
});

test('GET: perfil inexistente devuelve 404', async t => {
  mockSessions(t);
  t.mock.method(service, 'getPerfil', async () => { throw new service.PerfilNoEncontradoError(); });
  const response = await request('GET', signToken({ id: 12, rol: 'CLIENTE' }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { message: 'Perfil no encontrado.' });
});

test('GET: error de base devuelve 500 genérico sin filtrar detalles', async t => {
  mockSessions(t);
  t.mock.method(service, 'getPerfil', async () => {
    throw Object.assign(new Error('password=secreto tabla=USUARIO'), { code: 'ER_ACCESS_DENIED' });
  });
  const response = await request('GET', signToken({ id: 12, rol: 'CLIENTE' }));
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(text, JSON.stringify({ message: 'Error interno del servidor.' }));
  assert.ok(!text.includes('secreto'));
});

test('PATCH sin cookie: 401 sin consultar la base', async t => {
  t.mock.method(pool, 'query', () => assert.fail('No debe consultar la base sin sesión'));
  const response = await request('PATCH', null, { telefono: '294 400 0000' });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { message: 'No autenticado.' });
});

test('PATCH ADMIN: 403 sin ejecutar el servicio', async t => {
  mockSessions(t);
  t.mock.method(service, 'updatePerfil', () => assert.fail('ADMIN no debe editar perfiles de cliente'));
  const response = await request('PATCH', signToken({ id: 7, rol: 'ADMIN' }), { telefono: '294 400 0000' });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: 'El rol autenticado no tiene permiso.' });
});

const protectedFields = [
  'id', 'idCliente', 'id_cliente', 'email', 'password', 'password_hash', 'rol',
  'tipoCliente', 'tipo_cliente', 'nombreRazonSocial', 'docCliente', 'cuit',
  'estadoAprobacionEmpresa', 'cuentaCorrienteHabilitada', 'activo', 'es_fiel',
  'id_lista_precio', 'limite_credito',
];

for (const field of protectedFields) {
  test(`PATCH bloquea campo protegido: ${field}`, async t => {
    mockSessions(t);
    t.mock.method(service, 'updatePerfil', () => assert.fail('No debe ejecutar una actualización'));
    const response = await request('PATCH', signToken({ id: 12, rol: 'CLIENTE' }), { [field]: 'manipulado' });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message: 'El body contiene campos no permitidos.' });
  });
}

test('PATCH rechaza bodies no objetos y vacíos sin actualizar', async t => {
  mockSessions(t);
  t.mock.method(service, 'updatePerfil', () => assert.fail('No debe ejecutar una actualización'));
  for (const body of [null, 'texto']) {
    const response = await request('PATCH', signToken({ id: 12, rol: 'CLIENTE' }), body);
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(typeof Object.values(json)[0], 'string');
  }
  for (const [body, message] of [
    [[], 'El cuerpo de la solicitud es requerido y debe ser un objeto válido.'],
    [{}, 'Debe proporcionar al menos un campo válido para actualizar.'],
    [{ telefono: undefined }, 'Debe proporcionar al menos un campo válido para actualizar.'],
  ]) {
    const response = await request('PATCH', signToken({ id: 12, rol: 'CLIENTE' }), body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message });
  }
});

for (const [label, body] of [
  ['teléfono no textual', { telefono: 123 }],
  ['teléfono booleano', { telefono: true }],
  ['teléfono estructurado', { telefono: { valor: '123' } }],
  ['teléfono vacío', { telefono: '' }],
  ['teléfono solo espacios', { telefono: '   ' }],
  ['teléfono demasiado largo', { telefono: 'x'.repeat(51) }],
  ['dirección no textual', { direccion: 123 }],
  ['dirección vacía', { direccion: '' }],
  ['dirección demasiado larga', { direccion: 'x'.repeat(501) }],
]) {
  test(`PATCH rechaza ${label} sin actualizar`, async t => {
    mockSessions(t);
    t.mock.method(service, 'updatePerfil', () => assert.fail('No debe ejecutar una actualización'));
    const response = await request('PATCH', signToken({ id: 12, rol: 'CLIENTE' }), body);
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.ok(JSON.parse(text).message);
    assert.ok(!text.includes('x'.repeat(51)));
  });
}

test('PATCH PARTICULAR: recorta, actualiza solo campos enviados y devuelve el perfil', async t => {
  mockSessions(t);
  const actualizado = { ...perfilParticular, telefono: '294 455 1234' };
  t.mock.method(service, 'updatePerfil', async (id, dto) => {
    assert.equal(id, 12);
    assert.equal(dto.telefono, '294 455 1234');
    assert.equal(dto.direccion, undefined);
    return actualizado;
  });
  const response = await request('PATCH', signToken({ id: 12, rol: 'CLIENTE' }),
    { telefono: '  294 455 1234  ' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    message: 'Perfil actualizado correctamente.',
    data: { perfil: actualizado },
  });
});

test('PATCH EMPRESA: permite limpiar dirección con null', async t => {
  mockSessions(t);
  const actualizado = { ...perfilEmpresa, direccion: null };
  t.mock.method(service, 'updatePerfil', async (id, dto) => {
    assert.equal(id, 99);
    assert.equal(dto.telefono, undefined);
    assert.equal(dto.direccion, null);
    return actualizado;
  });
  const response = await request('PATCH', signToken({ id: 99, rol: 'CLIENTE' }), { direccion: null });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: 'Perfil actualizado correctamente.',
    data: { perfil: actualizado },
  });
});

test('PATCH no acepta IDs en la ruta: no existe /api/perfil/:id', async t => {
  mockSessions(t);
  t.mock.method(service, 'updatePerfil', () => assert.fail('No debe ejecutar una actualización'));
  const response = await request('PATCH', signToken({ id: 12, rol: 'CLIENTE' }),
    { telefono: '294 400 0000' }, `${base}/99`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Ruta no encontrada' });
});

test('PATCH: error de base devuelve 500 genérico sin actualización confirmada', async t => {
  mockSessions(t);
  t.mock.method(service, 'updatePerfil', async () => {
    throw Object.assign(new Error('ER_LOCK_DEADLOCK detalle interno'), { code: 'ER_LOCK_DEADLOCK' });
  });
  const response = await request('PATCH', signToken({ id: 12, rol: 'CLIENTE' }), { telefono: '294 400 0000' });
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(text, JSON.stringify({ message: 'Error interno del servidor.' }));
  assert.ok(!text.includes('ER_LOCK_DEADLOCK'));
});

test('PATCH: resultado de base desconocido informa sin confirmar la escritura', async t => {
  mockSessions(t);
  t.mock.method(service, 'updatePerfil', async () => {
    const { DatabaseOutcomeUnknownError } = require('../dist/config/database-policy');
    throw new DatabaseOutcomeUnknownError();
  });
  const response = await request('PATCH', signToken({ id: 12, rol: 'CLIENTE' }), { telefono: '294 400 0000' });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.message, 'No se pudo confirmar el resultado de la operación. Verificá el estado antes de reintentar.');
});
