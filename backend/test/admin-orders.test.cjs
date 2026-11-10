const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = '2bba238be4f1de0646384a41af287f48a9735015cdfd0347887226526104cf37';
}
require('./helpers/test-env.cjs');

const assert = require('node:assert/strict');
const { test, describe, after } = require('node:test');
const { once } = require('node:events');
const express = require('express');

const {
  parseAdminOrderIdParam,
  parseAdminOrderListQuery,
  parseAdminOrderStatusBody,
  getAllowedNextStates,
} = require('../dist/dtos/orders/admin-order.dto');
const { authorizeRoles } = require('../dist/middlewares/auth.middleware');
const { adminOrderRouter } = require('../dist/routes/adminOrder.routes');
const { destroyDatabase } = require('../dist/config/database.config');

describe('Task #277 — Pedidos ADMIN: DTOs, transiciones autorizadas y permisos HTTP', () => {
  after(async () => {
    if (typeof destroyDatabase === 'function') {
      await destroyDatabase();
    }
  });

  test('parseAdminOrderListQuery aplica valores por defecto y valida filtros permitidos', () => {
    const defaults = parseAdminOrderListQuery({});
    assert.deepEqual(defaults, { page: 1, limit: 20 });

    const filtered = parseAdminOrderListQuery({
      page: '2',
      limit: '10',
      estado: 'CONFIRMADO',
      modalidadPago: 'CUENTA_CORRIENTE',
      clienteId: '3',
      q: '  Empresa DEMO  ',
    });
    assert.deepEqual(filtered, {
      page: 2,
      limit: 10,
      estado: 'CONFIRMADO',
      modalidadPago: 'CUENTA_CORRIENTE',
      clienteId: 3,
      q: 'Empresa DEMO',
    });
  });

  test('parseAdminOrderListQuery rechaza parámetros desconocidos o fuera de rango', () => {
    assert.throws(
      () => parseAdminOrderListQuery({ saldo: '100' }),
      err => err.status === 400 && err.code === 'PARAMETRO_NO_PERMITIDO',
    );
    assert.throws(
      () => parseAdminOrderListQuery({ page: '0' }),
      err => err.status === 400 && err.code === 'PARAMETRO_INVALIDO',
    );
    assert.throws(
      () => parseAdminOrderListQuery({ limit: '51' }),
      err => err.status === 400 && err.code === 'PARAMETRO_INVALIDO',
    );
    assert.throws(
      () => parseAdminOrderListQuery({ estado: 'CANCELADO' }),
      err => err.status === 400 && err.code === 'ESTADO_FILTRO_INVALIDO',
    );
  });

  test('parseAdminOrderStatusBody autoriza solo estados definidos y bloquea campos financieros', () => {
    assert.deepEqual(parseAdminOrderStatusBody({ estado: 'EN_PREPARACION' }), {
      estado: 'EN_PREPARACION',
    });
    assert.deepEqual(parseAdminOrderStatusBody({ estado: 'ENVIADO' }), {
      estado: 'ENVIADO',
    });
    assert.deepEqual(parseAdminOrderStatusBody({ estado: 'ENTREGADO' }), {
      estado: 'ENTREGADO',
    });

    assert.throws(
      () => parseAdminOrderStatusBody({ estado: 'CANCELADO' }),
      err => err.status === 400 && err.code === 'ESTADO_PEDIDO_NO_AUTORIZADO',
    );
    assert.throws(
      () => parseAdminOrderStatusBody({ estado: 'ANULADO' }),
      err => err.status === 400 && err.code === 'ESTADO_PEDIDO_NO_AUTORIZADO',
    );

    assert.throws(
      () => parseAdminOrderStatusBody({ estado: 'EN_PREPARACION', total: '0.00' }),
      err => err.status === 400 && err.code === 'CAMPOS_NO_PERMITIDOS',
    );
    assert.throws(
      () => parseAdminOrderStatusBody({ subtotal: '100.00' }),
      err => err.status === 400 && err.code === 'CAMPOS_NO_PERMITIDOS',
    );
  });

  test('getAllowedNextStates define la secuencia autorizada y bloquea pedidos DEMO o ENTREGADO', () => {
    assert.deepEqual(getAllowedNextStates('CONFIRMADO', 'CUENTA_CORRIENTE'), [
      'EN_PREPARACION',
    ]);
    assert.deepEqual(getAllowedNextStates('EN_PREPARACION', 'CUENTA_CORRIENTE'), [
      'ENVIADO',
      'ENTREGADO',
    ]);
    assert.deepEqual(getAllowedNextStates('ENVIADO', 'CUENTA_CORRIENTE'), [
      'ENTREGADO',
    ]);
    assert.deepEqual(getAllowedNextStates('ENTREGADO', 'CUENTA_CORRIENTE'), []);
    assert.deepEqual(getAllowedNextStates('DEMO_REGISTRADO', 'DEMO_DIRECTO'), []);
    assert.deepEqual(getAllowedNextStates('CONFIRMADO', 'DEMO_CUENTA_CORRIENTE'), []);
  });

  test('parseAdminOrderIdParam valida IDs enteros positivos de 32 bits', () => {
    assert.equal(parseAdminOrderIdParam('42'), 42);
    assert.throws(
      () => parseAdminOrderIdParam('0'),
      err => err.status === 400 && err.code === 'PARAMETRO_INVALIDO',
    );
    assert.throws(
      () => parseAdminOrderIdParam('abc'),
      err => err.status === 400 && err.code === 'PARAMETRO_INVALIDO',
    );
  });

  test('Control de acceso ADMIN: 401 sin sesión, 403 con rol CLIENTE y 200 con rol ADMIN', async () => {
    const app = express();
    app.use(express.json());

    app.use(
      '/api/admin/pedidos',
      (req, _res, next) => {
        const testRole = req.headers['x-test-role'];
        if (testRole) {
          req.auth = { id: 1, rol: testRole };
        }
        next();
      },
      authorizeRoles('ADMIN'),
      (_req, res) => {
        res.status(200).json({ ok: true });
      },
    );

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/pedidos`;

    try {
      const anonRes = await fetch(baseUrl, { headers: { connection: 'close' } });
      assert.equal(anonRes.status, 401);
      const anonBody = await anonRes.json();
      assert.equal(anonBody.message, 'No autenticado.');

      const clientRes = await fetch(baseUrl, {
        headers: { 'x-test-role': 'CLIENTE', connection: 'close' },
      });
      assert.equal(clientRes.status, 403);
      const clientBody = await clientRes.json();
      assert.equal(clientBody.message, 'El rol autenticado no tiene permiso.');

      const adminRes = await fetch(baseUrl, {
        headers: { 'x-test-role': 'ADMIN', connection: 'close' },
      });
      assert.equal(adminRes.status, 200);
      const adminBody = await adminRes.json();
      assert.equal(adminBody.ok, true);
    } finally {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('adminOrderRouter aplica cabeceras de seguridad no-store y pragma no-cache', async () => {
    const app = express();
    app.use('/api/admin/pedidos', adminOrderRouter);

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/pedidos`;

    try {
      const res = await fetch(baseUrl, { headers: { connection: 'close' } });
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('pragma'), 'no-cache');
    } finally {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise(resolve => server.close(resolve));
    }
  });
});