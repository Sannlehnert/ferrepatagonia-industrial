const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, describe } = require('node:test');

const routerSource = fs.readFileSync(
  path.join(__dirname, '../src/router/index.ts'),
  'utf8',
);
const serviceSource = fs.readFileSync(
  path.join(__dirname, '../src/services/adminOrderService.ts'),
  'utf8',
);
const viewSource = fs.readFileSync(
  path.join(__dirname, '../src/views/admin/AdminOrdersView.vue'),
  'utf8',
);

describe('Task #277 — Frontend Pedidos ADMIN: ruteo, servicio y pantalla', () => {
  test('Ruta /admin/pedidos monta AdminOrdersView bajo protección de rol ADMIN', () => {
    assert.match(routerSource, /path:\s*'pedidos'/);
    assert.match(routerSource, /name:\s*'admin-orders'/);
    assert.match(routerSource, /import\('@\/views\/admin\/AdminOrdersView\.vue'\)/);
    assert.match(routerSource, /roles:\s*\['ADMIN'\]/);
  });

  test('adminOrderService consume los endpoints /admin/pedidos y formatea estados y montos', () => {
    assert.match(serviceSource, /'\/admin\/pedidos'/);
    assert.match(serviceSource, /`\/admin\/pedidos\/\$\{orderId\}`/);
    assert.match(serviceSource, /`\/admin\/pedidos\/\$\{orderId\}\/estado`/);
    assert.match(serviceSource, /CONFIRMADO:\s*'Confirmado'/);
    assert.match(serviceSource, /EN_PREPARACION:\s*'En preparación'/);
    assert.match(serviceSource, /ENVIADO:\s*'Enviado'/);
    assert.match(serviceSource, /ENTREGADO:\s*'Entregado'/);
  });

  test('AdminOrdersView valida rol ADMIN, usa usePrivateAccountRead y muestra detalle y seguimiento', () => {
    assert.match(viewSource, /auth\.rol === 'ADMIN' && !auth\.loggingOut && !auth\.loggingIn/);
    assert.match(viewSource, /usePrivateAccountRead/);
    assert.match(viewSource, /selectedOrder\.estadosPermitidos/);
    assert.match(viewSource, /updateAdminOrderStatus/);
    assert.match(viewSource, /Detalle del pedido #/);
    assert.match(viewSource, /Datos del cliente/);
    assert.match(viewSource, /Líneas del pedido/);
  });
});