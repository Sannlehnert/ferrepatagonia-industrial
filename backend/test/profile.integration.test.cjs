const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');

const protectedFields = [
  'id', 'idCliente', 'id_cliente', 'email', 'password', 'password_hash', 'rol',
  'tipoCliente', 'tipo_cliente', 'nombreRazonSocial', 'docCliente', 'cuit',
  'estadoAprobacionEmpresa', 'cuentaCorrienteHabilitada', 'activo', 'es_fiel',
  'id_lista_precio', 'limite_credito',
];

test('perfil propio en MariaDB: consulta, edición, IDOR y errores', {
  skip: !process.env.PROFILE_TEST_DATABASE,
}, async t => {
  const { env } = require('../dist/config/env.config');
  assert.equal(env.db.database, process.env.PROFILE_TEST_DATABASE, 'Confirmar la base de pruebas');
  const { pool } = require('../dist/config/catalog-snapshot.config');
  const { app } = require('../dist/app');
  const password = 'Perfil 336 de prueba';
  const emails = [];
  const clientIds = [];
  const userIds = [];
  const server = app.listen(0, '127.0.0.1');

  const baseUrl = () => `http://127.0.0.1:${server.address().port}`;
  const api = path => `${baseUrl()}/api${path}`;
  const request = (method, path, cookie, body) => fetch(api(path), {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = async email => {
    const response = await request('POST', '/auth/login', null, { email, password });
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get('set-cookie').split(';')[0];
  };
  const createCliente = async ({ tipo, nombre, doc = null, cuit = null, telefono = null,
    direccion = null, estado = null, conCuenta = false }) => {
    const email = `perfil-${randomUUID()}@example.test`;
    emails.push(email);
    const inserted = await pool.query(`INSERT INTO CLIENTE
      (tipo_cliente, nombre_razon_social, doc_cliente, cuit, email, telefono, direccion,
       estado_aprobacion_empresa, es_fiel, activo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
    [tipo, nombre, doc, cuit, email, telefono, direccion, estado]);
    const clienteId = Number(inserted.insertId);
    clientIds.push(clienteId);
    if (conCuenta) {
      await pool.query(`INSERT INTO CUENTA_CORRIENTE
        (id_cliente, limite_credito, habilitada, cobertura, plazo_dias, moneda_limite, origen_datos)
        VALUES (?, 0, 1, 'NO_ACREDITADA', NULL, 'USD', 'REAL')`, [clienteId]);
    }
    const user = await pool.query(`INSERT INTO USUARIO
      (id_cliente, email, password_hash, rol, activo) VALUES (?, ?, ?, 'CLIENTE', 1)`,
    [clienteId, email, await bcrypt.hash(password, 4)]);
    const id = Number(user.insertId);
    userIds.push(id);
    return { id, clienteId, email, cookie: await login(email) };
  };
  const row = async clienteId => (await pool.query(`SELECT c.*, u.email AS usuario_email,
    u.password_hash FROM CLIENTE c JOIN USUARIO u ON u.id_cliente = c.id_cliente
    WHERE c.id_cliente = ?`, [clienteId]))[0];

  try {
    await once(server, 'listening');
    const particular = await createCliente({ tipo: 'PARTICULAR', nombre: 'Persona Particular',
      doc: '30111222', telefono: '294 400 0000', direccion: 'Calle Particular 1' });
    const empresa = await createCliente({ tipo: 'EMPRESA', nombre: 'Empresa Andina S.R.L.',
      cuit: '30-71234567-8', telefono: '294 411 1111', direccion: 'Ruta 40 km 2',
      estado: 'PENDIENTE', conCuenta: true });

    await t.test('PARTICULAR consulta sus datos autorizados sin secretos', async () => {
      const response = await request('GET', '/perfil', particular.cookie);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const body = await response.json();
      assert.deepEqual(body, { data: { perfil: {
        id: particular.id,
        tipoCliente: 'PARTICULAR',
        nombreRazonSocial: 'Persona Particular',
        email: particular.email,
        docCliente: '30111222',
        cuit: null,
        telefono: '294 400 0000',
        direccion: 'Calle Particular 1',
        estadoAprobacionEmpresa: null,
        cuentaCorrienteHabilitada: null,
      } } });
      const serialized = JSON.stringify(body);
      for (const forbidden of ['password', 'password_hash', 'token', 'jwt', 'activo', 'es_fiel']) {
        assert.ok(!serialized.includes(forbidden), `No debe exponer ${forbidden}`);
      }
    });

    await t.test('PARTICULAR edita teléfono y dirección y persiste en MariaDB', async () => {
      const response = await request('PATCH', '/perfil', particular.cookie,
        { telefono: ' 294 455 9999 ', direccion: 'Nueva dirección 123' });
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      assert.equal(body.message, 'Perfil actualizado correctamente.');
      assert.equal(body.data.perfil.telefono, '294 455 9999');
      assert.equal(body.data.perfil.direccion, 'Nueva dirección 123');
      const stored = await row(particular.clienteId);
      assert.equal(stored.telefono, '294 455 9999');
      assert.equal(stored.direccion, 'Nueva dirección 123');
      assert.equal(stored.email, particular.email);
      assert.equal(stored.nombre_razon_social, 'Persona Particular');
      assert.equal(stored.doc_cliente, '30111222');
      const persisted = await (await request('GET', '/perfil', particular.cookie)).json();
      assert.equal(persisted.data.perfil.telefono, '294 455 9999');
      assert.equal(persisted.data.perfil.direccion, 'Nueva dirección 123');
    });

    await t.test('EMPRESA consulta estado y cuenta; edita sin alterar identidad', async () => {
      const read = await request('GET', '/perfil', empresa.cookie);
      assert.equal(read.status, 200);
      const before = (await read.json()).data.perfil;
      assert.deepEqual(before, {
        id: empresa.id,
        tipoCliente: 'EMPRESA',
        nombreRazonSocial: 'Empresa Andina S.R.L.',
        email: empresa.email,
        docCliente: null,
        cuit: '30-71234567-8',
        telefono: '294 411 1111',
        direccion: 'Ruta 40 km 2',
        estadoAprobacionEmpresa: 'PENDIENTE',
        cuentaCorrienteHabilitada: true,
      });
      const edit = await request('PATCH', '/perfil', empresa.cookie,
        { direccion: 'Parque Industrial 500', telefono: null });
      assert.equal(edit.status, 200, await edit.clone().text());
      const after = (await edit.json()).data.perfil;
      assert.equal(after.direccion, 'Parque Industrial 500');
      assert.equal(after.telefono, null);
      assert.equal(after.cuit, '30-71234567-8');
      assert.equal(after.nombreRazonSocial, 'Empresa Andina S.R.L.');
      assert.equal(after.estadoAprobacionEmpresa, 'PENDIENTE');
      // Nueva sesión: el cambio se lee desde la base, no de memoria.
      const relogin = await login(empresa.email);
      const persisted = await (await request('GET', '/perfil', relogin)).json();
      assert.equal(persisted.data.perfil.direccion, 'Parque Industrial 500');
      assert.equal(persisted.data.perfil.telefono, null);
      const stored = await row(empresa.clienteId);
      assert.equal(stored.direccion, 'Parque Industrial 500');
      assert.equal(stored.telefono, null);
      assert.equal(stored.cuit, '30-71234567-8');
    });

    await t.test('sin sesión: 401 en consulta y edición', async () => {
      for (const method of ['GET', 'PATCH']) {
        const response = await request(method, '/perfil', null, method === 'PATCH' ? { telefono: 'x' } : undefined);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { message: 'No autenticado.' });
      }
    });

    await t.test('ADMIN: 403 y no puede consultar ni editar perfiles', async () => {
      const adminEmail = `admin-perfil-${randomUUID()}@example.test`;
      emails.push(adminEmail);
      const inserted = await pool.query(`INSERT INTO USUARIO
        (id_cliente, email, password_hash, rol, activo) VALUES (NULL, ?, ?, 'ADMIN', 1)`,
      [adminEmail, await bcrypt.hash(password, 4)]);
      userIds.push(Number(inserted.insertId));
      const cookie = await login(adminEmail);
      for (const method of ['GET', 'PATCH']) {
        const response = await request(method, '/perfil', cookie,
          method === 'PATCH' ? { telefono: '294 400 0000' } : undefined);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { message: 'El rol autenticado no tiene permiso.' });
      }
    });

    await t.test('usuario A no puede modificar a B ni imponer IDs en body o ruta', async () => {
      const beforeB = await row(empresa.clienteId);
      for (const body of [
        { id: empresa.id, telefono: '294 400 0000' },
        { idCliente: empresa.clienteId, direccion: 'Ataque' },
        { id_cliente: empresa.clienteId, telefono: '294 400 0000' },
        { email: empresa.email, telefono: '294 400 0000' },
        { nombreRazonSocial: 'Empresa suplantada' },
      ]) {
        const response = await request('PATCH', '/perfil', particular.cookie, body);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { message: 'El body contiene campos no permitidos.' });
      }
      const byRoute = await request('PATCH', `/perfil/${empresa.clienteId}`, particular.cookie,
        { telefono: '294 400 0000' });
      assert.equal(byRoute.status, 404);
      const query = await request('GET', `/perfil?id_cliente=${empresa.clienteId}`, particular.cookie);
      assert.equal(query.status, 200);
      assert.equal((await query.json()).data.perfil.id, particular.id);
      const afterB = await row(empresa.clienteId);
      assert.equal(afterB.email, beforeB.email);
      assert.equal(afterB.nombre_razon_social, beforeB.nombre_razon_social);
      assert.equal(afterB.telefono, beforeB.telefono);
      assert.equal(afterB.direccion, beforeB.direccion);
      assert.equal(afterB.cuit, beforeB.cuit);
      assert.equal(afterB.estado_aprobacion_empresa, beforeB.estado_aprobacion_empresa);
    });

    await t.test('campos protegidos no se alteran mediante payload manipulado', async () => {
      const before = await row(particular.clienteId);
      for (const field of protectedFields) {
        const response = await request('PATCH', '/perfil', particular.cookie, { [field]: 'manipulado' });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { message: 'El body contiene campos no permitidos.' });
      }
      const after = await row(particular.clienteId);
      assert.deepEqual(after, before);
    });

    await t.test('datos inválidos se rechazan sin modificar la base', async () => {
      const before = await row(particular.clienteId);
      for (const body of [
        { telefono: 123 }, { telefono: true }, { telefono: [] }, { telefono: {} },
        { telefono: '' }, { telefono: '   ' }, { direccion: '' }, { direccion: 5 },
        { telefono: 'x'.repeat(51) }, { direccion: 'x'.repeat(501) },
        {}, { telefono: undefined },
      ]) {
        const response = await request('PATCH', '/perfil', particular.cookie, body);
        assert.equal(response.status, 400);
        const text = await response.text();
        assert.ok(JSON.parse(text).message);
      }
      const after = await row(particular.clienteId);
      assert.deepEqual(after, before);
    });

    await t.test('concurrencia: escrituras simultáneas no dejan estados parciales', async () => {
      const responses = await Promise.all([
        request('PATCH', '/perfil', particular.cookie, { telefono: '294 466 0001' }),
        request('PATCH', '/perfil', particular.cookie, { direccion: 'Concurrente 2' }),
      ]);
      assert.deepEqual(responses.map(response => response.status), [200, 200]);
      const stored = await row(particular.clienteId);
      assert.equal(stored.telefono, '294 466 0001');
      assert.equal(stored.direccion, 'Concurrente 2');

      const sameField = await Promise.all([
        request('PATCH', '/perfil', particular.cookie, { telefono: '294 466 1000' }),
        request('PATCH', '/perfil', particular.cookie, { telefono: '294 466 2000' }),
      ]);
      assert.deepEqual(sameField.map(response => response.status), [200, 200]);
      const final = await row(particular.clienteId);
      assert.ok(['294 466 1000', '294 466 2000'].includes(final.telefono));
    });

    await t.test('error simulado después de escribir revierte la actualización', async t => {
      const before = await row(particular.clienteId);
      const database = require('../dist/config/database.config');
      const { ClienteSchema } = require('../dist/entities/active.schemas');
      const transaction = database.inTransaction;
      t.mock.method(database, 'inTransaction', (work, options) => transaction(async manager => {
        const repository = manager.getRepository(ClienteSchema);
        const update = repository.update.bind(repository);
        t.mock.method(repository, 'update', async (...args) => {
          await update(...args);
          throw Error('fallo simulado después de escribir');
        });
        return work(manager);
      }, options));
      const response = await request('PATCH', '/perfil', particular.cookie,
        { telefono: '294 499 9999', direccion: 'No debe persistir' });
      assert.equal(response.status, 500);
      const text = await response.text();
      assert.equal(text, JSON.stringify({ message: 'Error interno del servidor.' }));
      assert.ok(!text.includes('fallo simulado'));
      const after = await row(particular.clienteId);
      assert.deepEqual(after, before);
    });

    await t.test('no hay regresión de autenticación ni de /auth/me', async () => {
      const me = await request('GET', '/auth/me', particular.cookie);
      assert.equal(me.status, 200);
      const user = (await me.json()).user;
      assert.equal(user.id, particular.id);
      assert.equal(user.email, particular.email);
      assert.equal(user.rol, 'CLIENTE');
      assert.equal(user.tipo_cliente, 'PARTICULAR');
      assert.ok(!JSON.stringify(user).includes('password'));
      const loginResponse = await request('POST', '/auth/login', null,
        { email: particular.email, password });
      assert.equal(loginResponse.status, 200);
      assert.ok(loginResponse.headers.get('set-cookie'));
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    try {
      for (const clienteId of clientIds) {
        await pool.query('DELETE FROM CUENTA_CORRIENTE WHERE id_cliente = ?', [clienteId]);
      }
      for (const userId of userIds) await pool.query('DELETE FROM USUARIO WHERE id_usuario = ?', [userId]);
      for (const clienteId of clientIds) await pool.query('DELETE FROM CLIENTE WHERE id_cliente = ?', [clienteId]);
    } finally {
      await pool.end();
    }
  }
});
