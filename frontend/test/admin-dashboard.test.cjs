const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
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
    const viewSource = fs.readFileSync(viewPath, 'utf8');

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
    const viewSource = fs.readFileSync(viewPath, 'utf8');

    assert.match(viewSource, /usePrivateAccountRead/);
    assert.match(viewSource, /getAdminDashboardMetrics/);
    assert.match(viewSource, /auth\.rol === 'ADMIN'/);
    assert.match(viewSource, /status === 403/);
    assert.match(viewSource, /pedidosPorEstado\.CONFIRMADO/);
    assert.match(viewSource, /pedidosPorEstado\.EN_PREPARACION/);
    assert.match(viewSource, /pedidosPorEstado\.ENVIADO/);
    assert.match(viewSource, /pedidosPorEstado\.ENTREGADO/);
    assert.match(viewSource, /\/admin\/pedidos/);
    assert.match(viewSource, /\/admin\/comprobantes/);
  });
});