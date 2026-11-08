const { randomUUID } = require('node:crypto');
const { assertOwned } = require('./cc260-disposable.cjs');

async function createOrderFixture(session, options = {}) {
  await assertOwned(session);
  const db = session.connection;
  const insert = async (sql, values) =>
    Number((await db.query(sql, values)).insertId);

  const {
    price = '10.00',
    discount = null,
    quantity = 2,
    stock = 5,
    verified = true,
    synthetic = false,
    limit = '1000.00',
  } = options;

  const adminId = await insert(`
    INSERT INTO USUARIO (email, password_hash, rol, activo)
    VALUES (?, 'fixture-no-login', 'ADMIN', 1)
  `, [`${randomUUID()}@example.test`]);

  const listId = discount === null ? null : await insert(`
    INSERT INTO LISTA_PRECIO (
      nombre, porcentaje_descuento, activa
    ) VALUES ('DEMO #261', ?, 1)
  `, [discount]);

  const clientId = await insert(`
    INSERT INTO CLIENTE (
      tipo_cliente, nombre_razon_social,
      estado_aprobacion_empresa, es_fiel, activo, id_lista_precio
    ) VALUES ('EMPRESA', 'DEMO #261', 'APROBADA', 0, 1, ?)
  `, [listId]);

  const userId = await insert(`
    INSERT INTO USUARIO (
      id_cliente, email, password_hash, rol, activo
    ) VALUES (?, ?, 'fixture-no-login', 'CLIENTE', 1)
  `, [clientId, `${randomUUID()}@example.test`]);

  const accountId = await insert(`
    INSERT INTO CUENTA_CORRIENTE (
      id_cliente, limite_credito, habilitada,
      cobertura, plazo_dias, moneda_limite,
      evidencia_limite, evidencia_plazo, evidencia_cobertura,
      cobertura_desde_utc, origen_datos
    ) VALUES (
      ?, ?, 1, 'COMPLETA', 30, 'USD',
      'DEMO #261', 'DEMO #261', 'DEMO #261',
      UTC_TIMESTAMP(3) - INTERVAL 1 DAY, 'DEMO'
    )
  `, [clientId, limit]);

  const categoryId = await insert(`
    INSERT INTO CATEGORIA (nombre, activo)
    VALUES ('DEMO #261', 1)
  `);

  const productId = await insert(`
    INSERT INTO PRODUCTO (
      id_categoria, codigo, nombre, precio, stock, activo
    ) VALUES (?, ?, 'DEMO #261', ?, ?, 1)
  `, [categoryId, randomUUID(), price, stock]);

  if (verified && price !== null) {
    await db.query(`
      INSERT INTO PRECIO_USD_EVIDENCIA (
        id_producto, precio_verificado, evidencia,
        id_admin, verificado_utc, valida, sintetica
      ) VALUES (
        ?, ?, 'Fixture aislado #261', ?,
        UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE, 1, ?
      )
    `, [productId, price, adminId, Number(synthetic)]);
  }

  const cartId = await insert(
    'INSERT INTO CARRITO (id_cliente) VALUES (?)',
    [clientId],
  );

  await db.query(`
    INSERT INTO ITEM_CARRITO (
      id_carrito, id_producto, cantidad
    ) VALUES (?, ?, ?)
  `, [cartId, productId, quantity]);

  return {
    clientId, userId, adminId, accountId,
    categoryId, productId, cartId, listId,
    auth: { id: userId, rol: 'CLIENTE' },
  };
}

module.exports = { createOrderFixture };