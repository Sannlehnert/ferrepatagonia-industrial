Object.assign(process.env, {
  JWT_SECRET: process.env.JWT_SECRET || 'unit-dashboard-secret-0123456789abcdef',
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: process.env.DB_PORT || '1',
  DB_NAME: process.env.DB_NAME || 'unit',
  DB_USER: process.env.DB_USER || 'unit',
  DB_PASSWORD: process.env.DB_PASSWORD || 'unit',
});

require('./helpers/test-env.cjs');

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('../dist/app');
const { dataSource } = require('../dist/config/database.config');
const usuarioRepository = require('../dist/repositories/usuario.repository');
const adminAccountRepository = require('../dist/repositories/adminAccount.repository');
const adminDashboardRepository = require('../dist/repositories/adminDashboard.repository');
const { signToken } = require('../dist/services/token.service');
const { authCookieName } = require('../dist/config/auth-cookie.config');

function randomUserId() {
  return crypto.randomInt(1000, 999999);
}

function cookieFor(id, rol) {
  return `${authCookieName}=${encodeURIComponent(signToken({ id, rol }))}`;
}

function createDefaultAggregates() {
  return {
    pedidosPorEstado: {
      CONFIRMADO: 3,
      EN_PREPARACION: 2,
      ENVIADO: 4,
      ENTREGADO: 11,
      totalOperativos: 20,
    },
    pedidosCuentaCorriente: 6,
    comprobantesTotales: 9,
    comprobantesSinRevisar: 4,
    alertasStockBajo: 7,
    productosSinStock: 2,
    empresasFieles: 5,
  };
}

describe('Task #347 — Métricas operativas verificables del Dashboard ADMIN', () => {
  let server;
  let baseUrl;
  let sessions;
  let aggregates;
  let onTransactionStart;

  let origFindUsuarioById;
  let origFindAccountReader;
  let origQueryAggregates;
  let origCreateQueryRunner;

  function registerSession(id, rol, activo = 1) {
    sessions.set(id, {
      id_usuario: id,
      email: `user-${id}@example.test`,
      rol,
      activo,
      nombre_razon_social: rol === 'CLIENTE' ? 'Cliente Prueba' : null,
      tipo_cliente: rol === 'CLIENTE' ? 'PARTICULAR' : null,
    });
    return id;
  }

  before(async () => {
    sessions = new Map();
    aggregates = createDefaultAggregates();
    onTransactionStart = null;

    origFindUsuarioById = usuarioRepository.findUsuarioById;
    origFindAccountReader = adminAccountRepository.findAccountReader;
    origQueryAggregates = adminDashboardRepository.queryAdminDashboardAggregates;
    origCreateQueryRunner = dataSource.createQueryRunner.bind(dataSource);

    usuarioRepository.findUsuarioById = async id => sessions.get(Number(id)) ?? null;

    adminAccountRepository.findAccountReader = async (_manager, userId) => {
      const row = sessions.get(Number(userId));
      return row ? { activo: Boolean(row.activo), rol: row.rol } : null;
    };

    adminDashboardRepository.queryAdminDashboardAggregates = async () => aggregates;

    dataSource.createQueryRunner = () => ({
      isTransactionActive: false,
      manager: {},
      async connect() {
        return { destroy() {} };
      },
      async startTransaction() {
        this.isTransactionActive = true;
        if (typeof onTransactionStart === 'function') {
          await onTransactionStart();
        }
      },
      async commitTransaction() {
        this.isTransactionActive = false;
      },
      async rollbackTransaction() {
        this.isTransactionActive = false;
      },
      async release() {},
    });

    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  afterEach(() => {
    sessions = new Map();
    aggregates = createDefaultAggregates();
    onTransactionStart = null;
  });

  after(async () => {
    usuarioRepository.findUsuarioById = origFindUsuarioById;
    adminAccountRepository.findAccountReader = origFindAccountReader;
    adminDashboardRepository.queryAdminDashboardAggregates = origQueryAggregates;
    dataSource.createQueryRunner = origCreateQueryRunner;
    if (server) {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
  });

  async function requestDashboard(queryString = '', cookie = '') {
    const headers = { Connection: 'close' };
    if (cookie) headers.Cookie = cookie;

    const response = await fetch(`${baseUrl}/api/admin/dashboard/metricas${queryString}`, {
      method: 'GET',
      headers,
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, headers: response.headers, body };
  }

  it('401 cuando la solicitud no envía cookie jwt_token y aplica cabeceras de privacidad', async () => {
    const res = await requestDashboard();
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.match(res.headers.get('vary') ?? '', /Cookie/i);
  });

  it('403 cuando el usuario autenticado tiene rol CLIENTE', async () => {
    const clientId = registerSession(randomUserId(), 'CLIENTE', 1);
    const res = await requestDashboard('', cookieFor(clientId, 'CLIENTE'));
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.match(res.headers.get('vary') ?? '', /Cookie/i);
  });

  it('403 si el usuario fue degradado en base de datos entre Passport y la transacción (TOCTOU de rol)', async () => {
    const adminId = registerSession(randomUserId(), 'ADMIN', 1);

    onTransactionStart = () => {
      registerSession(adminId, 'CLIENTE', 1);
    };

    const res = await requestDashboard('', cookieFor(adminId, 'ADMIN'));
    assert.equal(res.status, 403);
    assert.equal(res.body?.code, 'SIN_PERMISO');
  });

  it('401 si la cuenta ADMIN está desactivada en base de datos', async () => {
    const adminId = registerSession(randomUserId(), 'ADMIN', 0);
    const res = await requestDashboard('', cookieFor(adminId, 'ADMIN'));
    assert.equal(res.status, 401);
  });

  it('400 cuando se envían parámetros de consulta no permitidos', async () => {
    const adminId = registerSession(randomUserId(), 'ADMIN', 1);
    const res = await requestDashboard('?origen=DEMO', cookieFor(adminId, 'ADMIN'));
    assert.equal(res.status, 400);
    assert.equal(res.body?.code, 'PARAMETRO_NO_PERMITIDO');
  });

  it('200 retorna métricas operativas verificables, desglose por estado y cabeceras private no-store', async () => {
    const adminId = registerSession(randomUserId(), 'ADMIN', 1);
    const res = await requestDashboard('', cookieFor(adminId, 'ADMIN'));

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(res.headers.get('pragma'), 'no-cache');
    assert.match(res.headers.get('vary') ?? '', /Cookie/i);

    const data = res.body?.data;
    assert.ok(data, 'Debe incluir el objeto data');
    assert.equal(data.origenDatos, 'REAL');
    assert.equal(data.umbralStockBajo, 5);
    assert.ok(!Number.isNaN(Date.parse(data.corte)), 'corte debe ser un timestamp ISO válido');

    assert.deepEqual(data.pedidosPorEstado, {
      CONFIRMADO: 3,
      EN_PREPARACION: 2,
      ENVIADO: 4,
      ENTREGADO: 11,
      totalOperativos: 20,
    });

    assert.deepEqual(data.indicadores, {
      pedidosNuevos: 3,
      pedidosEnCurso: 6,
      pedidosCuentaCorriente: 6,
      comprobantesTotales: 9,
      comprobantesSinRevisar: 4,
      alertasStockBajo: 7,
      productosSinStock: 2,
      empresasFieles: 5,
    });
  });

  it('200 maneja correctamente escenario sin actividad operativa (ceros explícitos)', async () => {
    const adminId = registerSession(randomUserId(), 'ADMIN', 1);
    aggregates = {
      pedidosPorEstado: {
        CONFIRMADO: 0,
        EN_PREPARACION: 0,
        ENVIADO: 0,
        ENTREGADO: 0,
        totalOperativos: 0,
      },
      pedidosCuentaCorriente: 0,
      comprobantesTotales: 0,
      comprobantesSinRevisar: 0,
      alertasStockBajo: 0,
      productosSinStock: 0,
      empresasFieles: 0,
    };

    const res = await requestDashboard('', cookieFor(adminId, 'ADMIN'));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.pedidosPorEstado.totalOperativos, 0);
    assert.equal(res.body.data.indicadores.pedidosNuevos, 0);
    assert.equal(res.body.data.indicadores.comprobantesSinRevisar, 0);
    assert.equal(res.body.data.indicadores.alertasStockBajo, 0);
    assert.equal(res.body.data.indicadores.empresasFieles, 0);
  });

  it('las consultas SQL del repositorio excluyen explícitamente registros DEMO, FP-DEMO, cuentas DEMO y académicos', () => {
    const repoSource = fs.readFileSync(
      path.resolve(__dirname, '../src/repositories/adminDashboard.repository.ts'),
      'utf8',
    );
    assert.match(repoSource, /p\.estado NOT LIKE 'DEMO_%'/);
    assert.match(repoSource, /p\.modalidad_pago NOT LIKE 'DEMO_%'/);
    assert.match(repoSource, /cc\.origen_datos = 'REAL'/);
    assert.match(repoSource, /pr\.codigo NOT LIKE 'DEMO-%'/);
    assert.match(repoSource, /pr\.codigo NOT LIKE 'FP-DEMO-%'/);
    assert.match(repoSource, /NOT LIKE '%@demo\.local'/);
  });
});