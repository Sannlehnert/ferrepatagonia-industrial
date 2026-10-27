const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { signToken } = require('../../dist/services/token.service');

// Real accounts for integration tests only. Refuse databases outside the existing
// disposable runners, and never expose fixture credentials in test diagnostics.
exports.createAuthUser = async (pool, rol = 'ADMIN') => {
  const [identity] = await pool.query('SELECT DATABASE() AS name');
  assert.match(identity.name, /^(admin_products|categories)_test_[a-f0-9]{32}$/);
  assert.ok(['ADMIN', 'CLIENTE'].includes(rol));
  const email = `session-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(password, 4);
  const connection = await pool.getConnection();
  let clientId = null, id;
  try {
    await connection.beginTransaction();
    if (rol === 'CLIENTE') {
      const row = await connection.query("INSERT INTO CLIENTE(tipo_cliente,nombre_razon_social,email,estado_aprobacion_empresa,es_fiel,activo) VALUES ('PARTICULAR','Session fixture',?,NULL,0,1)", [email]);
      clientId = Number(row.insertId);
    }
    const user = await connection.query('INSERT INTO USUARIO(id_cliente,email,password_hash,rol,activo) VALUES (?,?,?,?,1)', [clientId, email, hash, rol]);
    id = Number(user.insertId);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  return { id, rol, email, password, clientId,
    cookie: 'jwt_token=' + encodeURIComponent(signToken({ id, rol })),
    async destroy() {
      await pool.query('DELETE FROM USUARIO WHERE id_usuario = ?', [id]);
      if (clientId !== null) await pool.query('DELETE FROM CLIENTE WHERE id_cliente = ?', [clientId]);
    },
  };
};
