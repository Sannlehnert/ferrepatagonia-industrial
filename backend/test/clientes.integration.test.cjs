require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

// Opt-in: lectura real y fixtures en una transacción que se revierte al terminar.
test('listado HTTP de cuentas registradas en MariaDB', { skip: !process.env.CLIENTES_TEST_DATABASE }, async (t) => {
  const { env } = require('../dist/config/env.config');
  assert.equal(env.db.database, process.env.CLIENTES_TEST_DATABASE, 'Confirmar la base de pruebas');
  const { pool } = require('../dist/config/catalog-snapshot.config');
  const { app } = require('../dist/app');
  const { signToken } = require('../dist/services/token.service');
  const adminCookie = `jwt_token=${encodeURIComponent(signToken({ id: 7, rol: 'ADMIN' }))}`;
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/admin/clientes`;
    await t.test('coincide con las cuentas CLIENTE asociadas y su orden, con sesión ADMIN', async () => {
      // Oráculo independiente: relacionar y ordenar en JS, sin repetir el JOIN probado.
      const clientes = await pool.query('SELECT id_cliente, nombre_razon_social FROM CLIENTE');
      const usuarios = await pool.query('SELECT id_cliente, email, rol, fecha_creacion FROM USUARIO');
      const porId = new Map(clientes.map(c => [Number(c.id_cliente), c]));
      const expected = usuarios.filter(u => u.rol === 'CLIENTE' && porId.has(Number(u.id_cliente)))
        .sort((a, b) => b.fecha_creacion - a.fecha_creacion || Number(b.id_cliente) - Number(a.id_cliente))
        .map(u => ({
          id: Number(u.id_cliente), nombreRazonSocial: porId.get(Number(u.id_cliente)).nombre_razon_social,
          email: u.email, fechaRegistro: u.fecha_creacion.toISOString(),
        }));
      const response = await fetch(url, { headers: { Cookie: adminCookie } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        message: 'Clientes obtenidos correctamente', data: { clientes: expected },
      });
    });

    await t.test('usa datos de cuenta, excluye clientes sin usuario y ADMIN, y desempata por id', async (t) => {
      const { dataSource } = require('../dist/config/database.config');
      const connection = dataSource.createQueryRunner();
      await connection.connect();
      const prefix = `test179-${randomUUID()}`;
      const fixtureIds = [];
      try {
        await connection.startTransaction();
        const addCliente = async (label, fechaAlta) => {
          const result = await connection.query(`INSERT INTO CLIENTE
            (tipo_cliente, nombre_razon_social, email, es_fiel, activo, fecha_alta)
            VALUES ('PARTICULAR', ?, ?, 0, 1, ?)`,
          [label, `${prefix}-${label}-comercial@example.test`, fechaAlta]);
          const id = Number(result.insertId);
          fixtureIds.push(id);
          return id;
        };
        const addUsuario = async (id, label, fechaCreacion, rol = 'CLIENTE') => {
          const email = `${prefix}-${label}-cuenta@example.test`;
          await connection.query(`INSERT INTO USUARIO
            (id_cliente, email, password_hash, rol, activo, fecha_creacion)
            VALUES (?, ?, 'fixture-no-login', ?, 1, ?)`, [id, email, rol, fechaCreacion]);
          return email;
        };
        const reciente = await addCliente('Reciente', '2000-01-01 00:00:00');
        const empate = await addCliente('Empate', '2001-01-01 00:00:00');
        const anterior = await addCliente('Anterior', '2002-01-01 00:00:00');
        const sinUsuario = await addCliente('SinUsuario', '2003-01-01 00:00:00');
        const recienteEmail = await addUsuario(reciente, 'Reciente', '2026-10-09 13:45:00');
        const empateEmail = await addUsuario(empate, 'Empate', '2026-10-09 13:45:00');
        const anteriorEmail = await addUsuario(anterior, 'Anterior', '2026-10-08 10:00:00');
        // El esquema exige que las cuentas ADMIN tengan id_cliente NULL.
        const adminEmail = await addUsuario(null, 'Admin', '2026-10-10 00:00:00', 'ADMIN');
        const dates = await connection.query('SELECT id_cliente, fecha_creacion FROM USUARIO WHERE email LIKE ?', [`${prefix}-%`]);
        const fechaPorId = new Map(dates.map(u => [Number(u.id_cliente), u.fecha_creacion.toISOString()]));

        // Ejecutar el SQL real del repositorio en la conexión de los fixtures sin confirmar datos.
        t.mock.method(connection, 'release', async () => {});
        t.mock.method(dataSource, 'createQueryRunner', () => connection);
        const response = await fetch(url, { headers: { Cookie: adminCookie } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.message, 'Clientes obtenidos correctamente');
        const listed = body.data.clientes;
        assert.deepEqual(listed.filter(c => fixtureIds.includes(c.id)), [
          { id: empate, nombreRazonSocial: 'Empate', email: empateEmail, fechaRegistro: fechaPorId.get(empate) },
          { id: reciente, nombreRazonSocial: 'Reciente', email: recienteEmail, fechaRegistro: fechaPorId.get(reciente) },
          { id: anterior, nombreRazonSocial: 'Anterior', email: anteriorEmail, fechaRegistro: fechaPorId.get(anterior) },
        ]);
        assert.ok(!listed.some(c => c.id === sinUsuario || c.email === adminEmail));
      } finally {
        t.mock.restoreAll();
        try { await connection.rollbackTransaction(); } finally { await connection.release(); }
      }
    });
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end();
  }
});
