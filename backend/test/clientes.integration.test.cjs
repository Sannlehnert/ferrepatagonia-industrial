const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');

// Opt-in y solo lectura sobre una base de pruebas identificada explícitamente.
test('listado HTTP coincide con MariaDB y su orden', { skip: !process.env.CLIENTES_TEST_DATABASE }, async () => {
  const { env } = require('../dist/config/env.config');
  assert.equal(env.db.database, process.env.CLIENTES_TEST_DATABASE, 'Confirmar la base de pruebas');
  const { pool } = require('../dist/config/database.config');
  const { app } = require('../dist/app');
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const rows = await pool.query(`SELECT id_cliente, nombre_razon_social FROM CLIENTE
      ORDER BY fecha_alta DESC, id_cliente DESC`);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/clientes`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: 'Clientes obtenidos correctamente',
      data: { clientes: rows.map(row => ({
        id: Number(row.id_cliente), nombreRazonSocial: row.nombre_razon_social,
      })) },
    });
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end();
  }
});
