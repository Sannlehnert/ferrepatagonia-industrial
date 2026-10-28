const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');

test('/auth/me en MariaDB: login, restauración, estado persistido y logout', {
  skip: !process.env.AUTH_ME_TEST_DATABASE,
}, async t => {
  const { env } = require('../dist/config/env.config');
  assert.equal(env.db.database, process.env.AUTH_ME_TEST_DATABASE);
  const { pool } = require('../dist/config/catalog-snapshot.config');
  const { app } = require('../dist/app');
  const emails = [];
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/auth`;
    const password = 'Prueba auth me 2026';
    for (const tipo of ['PARTICULAR', 'EMPRESA', null]) {
      await t.test(tipo || 'ADMIN sin cliente', async () => {
        const email = `auth-me-${randomUUID()}@example.test`;
        emails.push(email);
        let clienteId = null;
        if (tipo) {
          const result = await pool.query(`INSERT INTO CLIENTE
            (tipo_cliente, nombre_razon_social, email, es_fiel, activo, estado_aprobacion_empresa)
            VALUES (?, 'Prueba sesión', ?, 0, 1, ?)`, [tipo, email, tipo === 'EMPRESA' ? 'PENDIENTE' : null]);
          clienteId = Number(result.insertId);
        }
        const rol = tipo ? 'CLIENTE' : 'ADMIN';
        const inserted = await pool.query(`INSERT INTO USUARIO
          (id_cliente, email, password_hash, rol, activo) VALUES (?, ?, ?, ?, 1)`,
          [clienteId, email, await bcrypt.hash(password, 4), rol]);
        const id = Number(inserted.insertId);
        const expected = { id, nombre: tipo ? 'Prueba sesión' : 'Administrador', email, rol, tipo_cliente: tipo };
        const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }) });
        assert.equal(login.status, 200);
        assert.deepEqual(await login.json(), { message: 'Login exitoso', user: expected });
        let cookie = login.headers.get('set-cookie').split(';')[0];
        const me = () => fetch(`${base}/me`, { headers: cookie ? { Cookie: cookie } : {} });
        const restored = await me();
        assert.equal(restored.status, 200);
        assert.equal(restored.headers.get('set-cookie'), null);
        assert.deepEqual(await restored.json(), { user: expected });
        await pool.query('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [id]);
        const inactive = await me();
        assert.equal(inactive.status, 401);
        assert.deepEqual(await inactive.json(), { message: 'No autenticado.' });
        await pool.query('UPDATE USUARIO SET activo = 1 WHERE id_usuario = ?', [id]);
        if (tipo) {
          await pool.query("UPDATE USUARIO SET rol = 'ADMIN', id_cliente = NULL WHERE id_usuario = ?", [id]);
          const stale = await me();
          assert.equal(stale.status, 401);
          assert.deepEqual(await stale.json(), { message: 'No autenticado.' });
          await pool.query("UPDATE USUARIO SET rol = 'CLIENTE', id_cliente = ? WHERE id_usuario = ?", [clienteId, id]);
        }
        const logout = await fetch(`${base}/logout`, { method: 'POST', headers: { Cookie: cookie } });
        assert.equal(logout.status, 200);
        assert.deepEqual(await logout.json(), { message: 'Sesión cerrada correctamente' });
        assert.match(logout.headers.get('set-cookie'), /jwt_token=;/);
        assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
        // Aplicar la eliminación de cookie igual que un navegador; logout no revoca JWT.
        cookie = '';
        const loggedOut = await me();
        assert.equal(loggedOut.status, 401);
        assert.deepEqual(await loggedOut.json(), { message: 'No autenticado.' });
      });
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    try {
      for (const email of emails) {
        await pool.query('DELETE FROM USUARIO WHERE email = ?', [email]);
        await pool.query('DELETE FROM CLIENTE WHERE email = ?', [email]);
      }
    } finally { await pool.end(); }
  }
});
