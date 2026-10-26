require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

// Opt-in: crea datos identificados con UUID y elimina solo esos datos al terminar.
test('registro transaccional en MariaDB', { skip: !process.env.REGISTER_TEST_DATABASE }, async (t) => {
  const { env } = require('../dist/config/env.config');
  assert.equal(env.db.database, process.env.REGISTER_TEST_DATABASE, 'Confirmar la base de pruebas');
  const { pool } = require('../dist/config/catalog-snapshot.config');
  const { app } = require('../dist/app');
  const server = app.listen(0, '127.0.0.1');
  const emails = [];
  const makeBody = (tipoCliente) => {
    const email = `test164-${randomUUID()}@example.test`;
    emails.push(email);
    return { tipoCliente, nombreRazonSocial: 'Prueba transacción #164', email, password: 'Clave 164 de prueba' };
  };
  try {
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const post = (body) => fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const counts = async (email) => {
      const [row] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM CLIENTE WHERE email = ?) AS clientes,
                (SELECT COUNT(*) FROM USUARIO WHERE email = ?) AS usuarios`, [email, email]);
      return [Number(row.clientes), Number(row.usuarios)];
    };

    for (const tipoCliente of ['PARTICULAR', 'EMPRESA']) {
      await t.test(`${tipoCliente}: persiste ambas filas y revierte un duplicado`, async () => {
        const body = makeBody(tipoCliente);
        const response = await post(body);
        assert.equal(response.status, 201);
        assert.equal(response.headers.get('set-cookie'), null);
        const result = await response.json();
        assert.deepEqual(result, { message: 'Registro exitoso', data: { user: {
          id: result.data.user.id, email: body.email, rol: 'CLIENTE', tipoCliente,
        } } });
        assert.ok(Number.isInteger(result.data.user.id));
        const [row] = await pool.query(
          `SELECT u.id_usuario, u.password_hash, u.rol, u.activo AS usuario_activo,
                  c.*, (SELECT COUNT(*) FROM CUENTA_CORRIENTE cc WHERE cc.id_cliente = c.id_cliente) AS cuentas
           FROM USUARIO u JOIN CLIENTE c ON c.id_cliente = u.id_cliente WHERE u.email = ?`, [body.email]);
        assert.equal(row.id_usuario, result.data.user.id);
        assert.equal(row.rol, 'CLIENTE');
        assert.equal(row.tipo_cliente, tipoCliente);
        assert.equal(row.estado_aprobacion_empresa, tipoCliente === 'EMPRESA' ? 'PENDIENTE' : null);
        assert.equal(row.es_fiel, 0);
        assert.equal(row.activo, 1);
        assert.equal(row.usuario_activo, 1);
        assert.equal(Number(row.cuentas), 0);
        for (const field of ['doc_cliente', 'cuit', 'telefono', 'direccion']) assert.equal(row[field], null);
        assert.equal(await bcrypt.compare(body.password, row.password_hash), true);
        const duplicate = await post({ ...body, email: body.email.toUpperCase() });
        assert.equal(duplicate.status, 409);
        assert.deepEqual(await duplicate.json(), { message: 'El email ya está registrado.' });
        assert.deepEqual(await counts(body.email), [1, 1]);
      });
    }

    await t.test('error en INSERT USUARIO revierte CLIENTE y devuelve 500 genérico', async (t) => {
      const body = makeBody('PARTICULAR');
      const database = require('../dist/config/database.config');
      const { ClienteSchema, UsuarioSchema } = require('../dist/entities/active.schemas');
      const transaction = database.inTransaction;
      let insertedCliente = false;
      t.mock.method(database, 'inTransaction', callback => transaction(async manager => {
        const getRepository = manager.getRepository.bind(manager);
        t.mock.method(manager, 'getRepository', schema => {
          const repository = getRepository(schema);
          const insert = repository.insert.bind(repository);
          if (schema === UsuarioSchema) t.mock.method(repository, 'insert', async () => { throw Error('fallo simulado con detalle interno'); });
          if (schema === ClienteSchema) t.mock.method(repository, 'insert', async values => {
            const result = await insert(values); insertedCliente = true; return result;
          });
          return repository;
        });
        return callback(manager);
      }));
      const response = await post(body);
      assert.equal(insertedCliente, true);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { message: 'Error interno del servidor.' });
      assert.deepEqual(await counts(body.email), [0, 0]);
    });

    await t.test('dos registros simultáneos del mismo email crean solo un par', async () => {
      const body = makeBody('EMPRESA');
      const responses = await Promise.all([post(body), post(body)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
      await Promise.all(responses.map(r => r.json()));
      assert.deepEqual(await counts(body.email), [1, 1]);
    });

    await t.test('rol ADMIN y contraseña excesiva no crean filas', async () => {
      const body = makeBody('PARTICULAR');
      for (const invalid of [{ ...body, rol: 'ADMIN' }, { ...body, password: 'a'.repeat(73) }]) {
        const response = await post(invalid);
        assert.equal(response.status, 400);
        await response.json();
        assert.deepEqual(await counts(body.email), [0, 0]);
      }
    });

    await t.test('health sigue 200 después de las transacciones', async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { api: 'ok', database: 'ok' });
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    try {
      for (const email of emails) {
        await pool.query('DELETE FROM USUARIO WHERE email = ?', [email]);
        await pool.query('DELETE FROM CLIENTE WHERE email = ?', [email]);
      }
    } finally {
      await pool.end();
    }
  }
});
