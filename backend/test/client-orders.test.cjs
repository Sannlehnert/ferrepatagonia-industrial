const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const assert = require('node:assert/strict');
const { describe, test, before, after } = require('node:test');
const { once } = require('node:events');
const { app } = require('../dist/app');
const db = require('../dist/config/database.config');
const dataSource = db.dataSource;
const { signToken } = require('../dist/services/token.service');

describe('Task #273 (S6-24.1) — API protegida de historial y detalle de pedidos propios', () => {
  let server;
  let baseUrl;

  const createdOrderIds = [];
  const createdProductIds = [];
  const createdCategoryIds = [];
  const createdUserIds = [];
  const createdClientIds = [];

  async function createTestClient({ activo = 1, userActivo = 1 } = {}) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const clientRes = await dataSource.query(`
      INSERT INTO CLIENTE (
        tipo_cliente, nombre_razon_social, email, es_fiel, activo
      ) VALUES ('PARTICULAR', ?, ?, 0, ?)
    `, [`Cliente Test ${suffix}`, `cli-${suffix}@example.test`, activo]);
    const clientId = Number(clientRes.insertId);
    createdClientIds.push(clientId);

    const userRes = await dataSource.query(`
      INSERT INTO USUARIO (
        id_cliente, email, password_hash, rol, activo
      ) VALUES (?, ?, '$2b$10$abcdefghijklmnopqrstuv', 'CLIENTE', ?)
    `, [clientId, `usr-${suffix}@example.test`, userActivo]);
    const userId = Number(userRes.insertId);
    createdUserIds.push(userId);

    const token = signToken({ id: userId, rol: 'CLIENTE' });
    return { clientId, userId, cookie: `jwt_token=${token}` };
  }

  async function createTestAdmin() {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const userRes = await dataSource.query(`
      INSERT INTO USUARIO (
        id_cliente, email, password_hash, rol, activo
      ) VALUES (NULL, ?, '$2b$10$abcdefghijklmnopqrstuv', 'ADMIN', 1)
    `, [`adm-${suffix}@example.test`]);
    const userId = Number(userRes.insertId);
    createdUserIds.push(userId);

    const token = signToken({ id: userId, rol: 'ADMIN' });
    return { userId, cookie: `jwt_token=${token}` };
  }

  before(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    try {
      if (dataSource.isInitialized) {
        for (const orderId of createdOrderIds) {
          await dataSource.query('DELETE FROM DETALLE_PEDIDO WHERE id_pedido = ?', [orderId]);
          await dataSource.query('DELETE FROM PEDIDO WHERE id_pedido = ?', [orderId]);
        }
        for (const prodId of createdProductIds) {
          await dataSource.query('DELETE FROM PRODUCTO WHERE id_producto = ?', [prodId]);
        }
        for (const catId of createdCategoryIds) {
          await dataSource.query('DELETE FROM CATEGORIA WHERE id_categoria = ?', [catId]);
        }
        for (const userId of createdUserIds) {
          await dataSource.query('DELETE FROM USUARIO WHERE id_usuario = ?', [userId]);
        }
        for (const clientId of createdClientIds) {
          await dataSource.query('DELETE FROM CLIENTE WHERE id_cliente = ?', [clientId]);
        }
      }
    } finally {
      if (server) {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        await new Promise(resolve => server.close(resolve));
      }
      if (typeof db.destroyDatabase === 'function') {
        await db.destroyDatabase();
      } else if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    }
  });

  test('Rechaza solicitudes sin autenticar con 401 en listado y detalle', async () => {
    const listRes = await fetch(`${baseUrl}/api/pedidos`);
    assert.equal(listRes.status, 401);

    const detailRes = await fetch(`${baseUrl}/api/pedidos/1`);
    assert.equal(detailRes.status, 401);
  });

  test('Rechaza rol ADMIN con 403 y cliente inhabilitado con 403', async () => {
    const admin = await createTestAdmin();
    const disabledClient = await createTestClient({ activo: 0 });

    const adminList = await fetch(`${baseUrl}/api/pedidos`, {
      headers: { Cookie: admin.cookie },
    });
    assert.equal(adminList.status, 403);

    const adminDetail = await fetch(`${baseUrl}/api/pedidos/1`, {
      headers: { Cookie: admin.cookie },
    });
    assert.equal(adminDetail.status, 403);

    const disabledRes = await fetch(`${baseUrl}/api/pedidos`, {
      headers: { Cookie: disabledClient.cookie },
    });
    assert.equal(disabledRes.status, 403);
    const body = await disabledRes.json();
    assert.equal(body.code, 'CLIENTE_NO_HABILITADO');
  });

  test('Rechaza query params arbitrarios (como clienteId) e IDs inválidos con 400', async () => {
    const client = await createTestClient();

    const queryList = await fetch(`${baseUrl}/api/pedidos?clienteId=999`, {
      headers: { Cookie: client.cookie },
    });
    assert.equal(queryList.status, 400);

    const queryDetail = await fetch(`${baseUrl}/api/pedidos/1?clienteId=999`, {
      headers: { Cookie: client.cookie },
    });
    assert.equal(queryDetail.status, 400);

    for (const invalidId of ['0', '-5', 'abc', '1.5']) {
      const badIdRes = await fetch(`${baseUrl}/api/pedidos/${invalidId}`, {
        headers: { Cookie: client.cookie },
      });
      assert.equal(badIdRes.status, 400);
      const body = await badIdRes.json();
      assert.equal(body.code, 'PEDIDO_ID_INVALIDO');
    }
  });

  test('Devuelve lista vacía cuando el cliente no registra pedidos', async () => {
    const client = await createTestClient();

    const res = await fetch(`${baseUrl}/api/pedidos`, {
      headers: { Cookie: client.cookie },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');

    const body = await res.json();
    assert.deepEqual(body, { data: { items: [] } });
  });

  test('Anti-IDOR e importes históricos: cada cliente ve solo sus pedidos y conserva precios históricos', async () => {
    const clientA = await createTestClient();
    const clientB = await createTestClient();

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const catRes = await dataSource.query(`
      INSERT INTO CATEGORIA (nombre, descripcion, activo)
      VALUES (?, 'Cat test', 1)
    `, [`Cat-${suffix}`]);
    const categoryId = Number(catRes.insertId);
    createdCategoryIds.push(categoryId);

    const prodRes = await dataSource.query(`
      INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo)
      VALUES (?, ?, 'Amoladora Industrial', '50.00', 20, 1)
    `, [categoryId, `SKU-${suffix}`]);
    const productId = Number(prodRes.insertId);
    createdProductIds.push(productId);

    // Pedido de Cliente A con precio histórico unitario 50.00 (2 unidades, desc 10.00, total 90.00)
    const orderARes = await dataSource.query(`
      INSERT INTO PEDIDO (
        id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total
      ) VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', '100.00', '10.00', '90.00', 'USD')
    `, [clientA.clientId]);
    const orderAId = Number(orderARes.insertId);
    createdOrderIds.push(orderAId);

    await dataSource.query(`
      INSERT INTO DETALLE_PEDIDO (
        id_pedido, id_producto, cantidad, precio_unitario, descuento, subtotal
      ) VALUES (?, ?, 2, '50.00', '10.00', '90.00')
    `, [orderAId, productId]);

    // Pedido de Cliente B
    const orderBRes = await dataSource.query(`
      INSERT INTO PEDIDO (
        id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total
      ) VALUES (?, 'EN_PREPARACION', 'TRANSFERENCIA', '200.00', '0.00', '200.00', 'USD')
    `, [clientB.clientId]);
    const orderBId = Number(orderBRes.insertId);
    createdOrderIds.push(orderBId);

    await dataSource.query(`
      INSERT INTO DETALLE_PEDIDO (
        id_pedido, id_producto, cantidad, precio_unitario, descuento, subtotal
      ) VALUES (?, ?, 4, '50.00', '0.00', '200.00')
    `, [orderBId, productId]);

    // Cambiamos el precio actual del producto en catálogo a 999.99 para probar que el pedido usa el histórico
    await dataSource.query(`
      UPDATE PRODUCTO SET precio = '999.99' WHERE id_producto = ?
    `, [productId]);

    // 1. Cliente A lista sus pedidos: solo ve orderAId con importe histórico 90.00
    const listARes = await fetch(`${baseUrl}/api/pedidos`, {
      headers: { Cookie: clientA.cookie },
    });
    assert.equal(listARes.status, 200);
    const listABody = await listARes.json();
    assert.equal(listABody.data.items.length, 1);
    assert.equal(listABody.data.items[0].pedidoId, orderAId);
    assert.equal(listABody.data.items[0].estado, 'CONFIRMADO');
    assert.equal(listABody.data.items[0].subtotal, '100.00');
    assert.equal(listABody.data.items[0].descuento, '10.00');
    assert.equal(listABody.data.items[0].total, '90.00');
    assert.equal(listABody.data.items[0].cantidadUnidades, 2);

    // 2. Cliente A consulta el detalle de su pedido: ve sus líneas con precio histórico 50.00 (no 999.99)
    const detailARes = await fetch(`${baseUrl}/api/pedidos/${orderAId}`, {
      headers: { Cookie: clientA.cookie },
    });
    assert.equal(detailARes.status, 200);
    const detailABody = await detailARes.json();
    assert.equal(detailABody.data.pedidoId, orderAId);
    assert.equal(detailABody.data.items.length, 1);
    assert.equal(detailABody.data.items[0].productoId, productId);
    assert.equal(detailABody.data.items[0].precioUnitario, '50.00');
    assert.equal(detailABody.data.items[0].descuento, '10.00');
    assert.equal(detailABody.data.items[0].subtotal, '90.00');

    // 3. Anti-IDOR: Cliente A intenta consultar el pedido de Cliente B -> 404 PEDIDO_NO_ENCONTRADO
    const idorRes = await fetch(`${baseUrl}/api/pedidos/${orderBId}`, {
      headers: { Cookie: clientA.cookie },
    });
    assert.equal(idorRes.status, 404);
    const idorBody = await idorRes.json();
    assert.equal(idorBody.code, 'PEDIDO_NO_ENCONTRADO');
  });
});