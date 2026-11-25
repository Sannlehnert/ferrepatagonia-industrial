const assert = require('node:assert/strict');
const { beforeEach, test, mock } = require('node:test');
const { randomBytes } = require('node:crypto');

Object.assign(process.env, {
  JWT_SECRET: randomBytes(32).toString('hex'),
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  DB_NAME: 'unit',
  DB_USER: 'unit',
  DB_PASSWORD: 'unit',
});

const { adminClientQueryPolicy } = require('../dist/dtos/clients/admin-client-query.dto');
const { validateDtoInput } = require('../dist/dtos/validation');
const service = require('../dist/services/clientes.service');
const { getClientes } = require('../dist/controllers/clientes.controller');

const validQuery = async input => {
  const result = await validateDtoInput(adminClientQueryPolicy, input);
  assert.equal(result.valid, true, JSON.stringify(input));
  return result.data;
};

const response = () => {
  const captured = { status: 200, body: null };
  return {
    captured,
    status(code) { captured.status = code; return this; },
    json(body) { captured.body = body; return this; },
  };
};

beforeEach(() => mock.restoreAll());

test('query de clientes acepta page, limit, búsqueda y filtros, y normaliza texto', async () => {
  const dto = await validQuery({
    page: '2',
    limit: '20',
    busqueda: '  Constructora Sur  ',
    tipo: 'empresa',
    estadoEmpresa: 'aprobada',
  });
  assert.equal(dto.page, 2);
  assert.equal(dto.limit, 20);
  assert.equal(dto.busqueda, 'Constructora Sur');
  assert.equal(dto.tipo, 'EMPRESA');
  assert.equal(dto.estadoEmpresa, 'APROBADA');
});

test('query de clientes rechaza parámetros inválidos, repetidos y combinaciones engañosas', async () => {
  const invalid = [
    { page: '01' }, { page: '0' }, { page: '1e0' }, { page: '1000001' },
    { limit: '0' }, { limit: '101' }, { limit: '1.5' },
    { busqueda: '   ' }, { busqueda: 'x'.repeat(201) }, { busqueda: '\u0000' },
    { tipo: 'ADMIN' },
    { estadoEmpresa: 'OTRO' },
    { tipo: 'PARTICULAR', estadoEmpresa: 'PENDIENTE' },
    { tipo: 'PARTICULAR', estadoEmpresa: 'APROBADA' },
    { extra: '1' },
    { page: ['1', '2'] },
    { page: null },
    [],
    null,
  ];
  for (const input of invalid) {
    const result = await validateDtoInput(adminClientQueryPolicy, input);
    assert.equal(result.valid, false, JSON.stringify(input));
    assert.equal(typeof result.message, 'string');
  }
});

test('GET sin parámetros conserva el contrato histórico de listClientes', async t => {
  const list = t.mock.method(service, 'listClientes', async () => [{ id: 1 }]);
  const page = t.mock.method(service, 'listClientesPage', async () => {
    throw new Error('no debe paginar sin parámetros');
  });
  const res = response();
  await getClientes({}, res);

  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body, {
    message: 'Clientes obtenidos correctamente',
    data: { clientes: [{ id: 1 }] },
  });
  assert.equal(list.mock.callCount(), 1);
  assert.equal(page.mock.callCount(), 0);
});

test('GET con parámetros devuelve clientes y paginación aditiva', async t => {
  const list = t.mock.method(service, 'listClientes', async () => {
    throw new Error('no debe usar el listado completo');
  });
  const page = t.mock.method(service, 'listClientesPage', async query => ({
    clientes: [{ id: 7 }],
    paginacion: { page: query.page ?? 1, limit: query.limit ?? 20, total: 21, totalPages: 2 },
  }));
  const res = response();
  const dto = await validQuery({ page: '2', limit: '20', busqueda: '7', tipo: 'EMPRESA' });
  await getClientes({}, Object.assign(res, { locals: { dto: { query: dto } } }));

  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body, {
    message: 'Clientes obtenidos correctamente',
    data: {
      clientes: [{ id: 7 }],
      paginacion: { page: 2, limit: 20, total: 21, totalPages: 2 },
    },
  });
  assert.equal(list.mock.callCount(), 0);
  assert.deepEqual(page.mock.calls[0].arguments[0].busqueda, '7');
});

test('errores del repositorio devuelven 500 genérico sin filtrar detalles', async t => {
  t.mock.method(service, 'listClientesPage', async () => {
    throw new Error('SQL privado con credenciales');
  });
  t.mock.method(console, 'error', () => {});
  const res = response();
  const dto = await validQuery({ page: '1', limit: '20' });
  await getClientes({}, Object.assign(res, { locals: { dto: { query: dto } } }));

  assert.equal(res.captured.status, 500);
  assert.deepEqual(res.captured.body, { message: 'Error interno del servidor.' });
});
