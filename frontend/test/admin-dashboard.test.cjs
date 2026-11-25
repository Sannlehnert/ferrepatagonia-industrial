const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
const metricsPath = path.join(frontendRoot, 'src/components/AdminDashboardMetrics.vue');
const ordersPath = path.join(frontendRoot, 'src/components/AdminDashboardOrders.vue');
const viewPath = path.join(frontendRoot, 'src/views/admin/AdminDashboardView.vue');
const servicePath = path.join(frontendRoot, 'src/services/adminDashboardService.ts');
const typesPath = path.join(frontendRoot, 'src/types/adminDashboard.ts');

describe('Task #347 — Frontend AdminDashboardView y servicio de métricas reales', () => {
  it('existen los archivos de tipos, servicio y vista del dashboard administrativo', () => {
    assert.equal(fs.existsSync(typesPath), true, 'Debe existir frontend/src/types/adminDashboard.ts');
    assert.equal(fs.existsSync(servicePath), true, 'Debe existir frontend/src/services/adminDashboardService.ts');
    assert.equal(fs.existsSync(viewPath), true, 'Debe existir frontend/src/views/admin/AdminDashboardView.vue');
  });

  it('adminDashboardService consulta /admin/dashboard/metricas soportando AbortSignal', () => {
    const serviceSource = fs.readFileSync(servicePath, 'utf8');
    assert.match(serviceSource, /\/admin\/dashboard\/metricas/);
    assert.match(serviceSource, /signal\?:\s*AbortSignal/);
  });

  it('AdminDashboardView elimina métricas hardcodeadas y textos de datos inventados', () => {
    const viewSource = [viewPath, metricsPath, ordersPath].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    assert.doesNotMatch(
      viewSource,
      /value:\s*5\b/,
      'No deben quedar valores hardcodeados en 5 en las métricas',
    );
    assert.doesNotMatch(
      viewSource,
      /Vista de estructura con datos de ejemplo/i,
      'No debe mostrarse la leyenda de datos de ejemplo',
    );
    assert.doesNotMatch(
      viewSource,
      /<style\b/,
      'La vista debe usar utilidades Tailwind sin bloques <style>',
    );
  });

  it('AdminDashboardView protege la lectura por sesión ADMIN, suprime flash en 403 y expone desglose por estado', () => {
    const viewSource = [viewPath, metricsPath, ordersPath].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    assert.match(viewSource, /usePrivateAccountRead/);
    assert.match(viewSource, /getAdminDashboardMetrics/);
    assert.match(viewSource, /auth\.rol === 'ADMIN'/);
    assert.match(viewSource, /status === 403/);
    assert.match(viewSource, /counts\?\.CONFIRMADO/);
    assert.match(viewSource, /counts\?\.EN_PREPARACION/);
    assert.match(viewSource, /counts\?\.ENVIADO/);
    assert.match(viewSource, /counts\?\.ENTREGADO/);
    assert.match(viewSource, /name: 'admin-orders'/);
    assert.match(viewSource, /AdminDashboardOrders/);
  });

  it('AdminDashboardView describe la métrica de cuenta corriente por modalidad y no como operaciones abonadas (H02)', () => {
    const viewSource = [viewPath, metricsPath, ordersPath].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    assert.doesNotMatch(
      viewSource,
      /abonadas/i,
      'La vista no debe describir pedidos con cuenta corriente como operaciones abonadas',
    );
    assert.match(
      viewSource,
      /Pedidos con cuenta corriente/i,
      'La vista debe describir el indicador por modalidad de cuenta corriente',
    );
  });
});