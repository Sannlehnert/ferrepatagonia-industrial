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
    assert.doesNotMatch(repoSource, /p\.modalidad_pago\s*<>\s*'CUENTA_CORRIENTE'/);
  });

  it('regresión H01: queryAdminDashboardAggregates excluye empresas/pedidos/comprobantes con cuenta DEMO (FER-19) y preserva empresas reales con y sin cuenta corriente', async () => {
    function createSqlEvaluatingManager({ clientes = [], cuentas = [], pedidos = [], comprobantes = [] }) {
      const findCuentaByCliente = idCliente => cuentas.find(cc => cc.id_cliente === idCliente) ?? null;
      const findCuentaById = idCuenta => cuentas.find(cc => cc.id_cuenta_corriente === idCuenta) ?? null;
      const findClienteById = idCliente => clientes.find(c => c.id_cliente === idCliente) ?? null;
      const findPedidoById = idPedido => pedidos.find(p => p.id_pedido === idPedido) ?? null;

      function matchesRealOrderFilter(sql, params, pedido) {
        const cliente = findClienteById(pedido.id_cliente);
        if (!cliente) return false;
        const cc = findCuentaByCliente(pedido.id_cliente);
        const academicPrefix = String(params?.[0] ?? '').replace(/%$/, '');

        if (/p\.estado NOT LIKE 'DEMO_%'/.test(sql) && pedido.estado.startsWith('DEMO_')) return false;
        if (/p\.modalidad_pago NOT LIKE 'DEMO_%'/.test(sql) && pedido.modalidad_pago.startsWith('DEMO_')) return false;
        if (
          /p\.evidencia_total_usd NOT LIKE \?/.test(sql) &&
          academicPrefix &&
          typeof pedido.evidencia_total_usd === 'string' &&
          pedido.evidencia_total_usd.startsWith(academicPrefix)
        ) {
          return false;
        }
        if (/c\.email NOT LIKE '%@demo\.local'/.test(sql) && cliente.email?.endsWith('@demo.local')) return false;

        if (/p\.modalidad_pago\s*<>\s*'CUENTA_CORRIENTE'/.test(sql)) {
          if (pedido.modalidad_pago === 'CUENTA_CORRIENTE' && cc && cc.origen_datos !== 'REAL') return false;
        } else if (/\(cc\.id_cuenta_corriente IS NULL OR cc\.origen_datos = 'REAL'\)/.test(sql)) {
          if (cc && cc.origen_datos !== 'REAL') return false;
        }
        return true;
      }

      return {
        async query(sql, params = []) {
          if (/FROM\s+PEDIDO\s+p\b/i.test(sql) && !/FROM\s+COMPROBANTE_PAGO\s+cp\b/i.test(sql)) {
            const matched = pedidos.filter(p => matchesRealOrderFilter(sql, params, p));
            return [
              {
                confirmados: matched.filter(p => p.estado === 'CONFIRMADO').length,
                en_preparacion: matched.filter(p => p.estado === 'EN_PREPARACION').length,
                enviados: matched.filter(p => p.estado === 'ENVIADO').length,
                entregados: matched.filter(p => p.estado === 'ENTREGADO').length,
                cuenta_corriente: matched.filter(p => p.modalidad_pago === 'CUENTA_CORRIENTE').length,
              },
            ];
          }

          if (/FROM\s+COMPROBANTE_PAGO\s+cp\b/i.test(sql)) {
            const hasCcCpJoin = /LEFT\s+JOIN\s+CUENTA_CORRIENTE\s+cc_cp\s+ON\s+cc_cp\.id_cliente\s*=\s*cp\.id_cliente/i.test(sql);
            const hasCcCpFilter = /\(cc_cp\.id_cuenta_corriente IS NULL OR cc_cp\.origen_datos = 'REAL'\)/i.test(sql);
            const matched = comprobantes.filter(cp => {
              const cCp = findClienteById(cp.id_cliente);
              if (!cCp) return false;
              if (/c_cp\.email NOT LIKE '%@demo\.local'/.test(sql) && cCp.email?.endsWith('@demo.local')) return false;
              const ccCp = hasCcCpJoin ? findCuentaByCliente(cp.id_cliente) : null;
              if (hasCcCpJoin && hasCcCpFilter && ccCp && ccCp.origen_datos !== 'REAL') return false;

              const ccDirect = cp.id_cuenta_corriente != null ? findCuentaById(cp.id_cuenta_corriente) : null;
              if (cp.id_cuenta_corriente != null && (!ccDirect || ccDirect.origen_datos !== 'REAL')) return false;

              if (cp.id_pedido != null) {
                const pedido = findPedidoById(cp.id_pedido);
                return pedido ? matchesRealOrderFilter(sql, params, pedido) : false;
              }
              return cp.id_cuenta_corriente != null && ccDirect?.origen_datos === 'REAL';
            });
            return [
              {
                totales: matched.length,
                sin_revisar: matched.filter(cp => cp.id_admin_revision == null).length,
              },
            ];
          }

          if (/FROM\s+PRODUCTO\s+pr\b/i.test(sql)) {
            return [{ stock_bajo: 0, sin_stock: 0 }];
          }

          if (/FROM\s+CLIENTE\s+c\b/i.test(sql)) {
            const hasLeftJoinCc = /LEFT\s+JOIN\s+CUENTA_CORRIENTE\s+cc\s+ON\s+cc\.id_cliente\s*=\s*c\.id_cliente/i.test(sql);
            const hasInnerJoinCc = /INNER\s+JOIN\s+CUENTA_CORRIENTE\s+cc\s+ON\s+cc\.id_cliente\s*=\s*c\.id_cliente/i.test(sql);
            const hasCcRealFilter = /cc\.origen_datos\s*=\s*'REAL'/i.test(sql);
            const allowsCcNull = /cc\.id_cuenta_corriente\s+IS\s+NULL/i.test(sql);

            const matched = clientes.filter(c => {
              if (/c\.tipo_cliente\s*=\s*'EMPRESA'/.test(sql) && c.tipo_cliente !== 'EMPRESA') return false;
              if (/c\.activo\s*=\s*1/.test(sql) && c.activo !== 1) return false;
              if (/c\.estado_aprobacion_empresa\s*=\s*'APROBADA'/.test(sql) && c.estado_aprobacion_empresa !== 'APROBADA') {
                return false;
              }
              if (/c\.es_fiel\s*=\s*1/.test(sql) && c.es_fiel !== 1) return false;
              if (/c\.email NOT LIKE '%@demo\.local'/.test(sql) && c.email?.endsWith('@demo.local')) return false;

              const cc = findCuentaByCliente(c.id_cliente);
              if (hasInnerJoinCc && !cc) return false;
              if ((hasLeftJoinCc || hasInnerJoinCc) && hasCcRealFilter) {
                if (cc === null) return allowsCcNull;
                if (cc.origen_datos !== 'REAL') return false;
              }
              return true;
            });

            return [{ empresas_fieles: matched.length }];
          }

          throw new Error(`Consulta SQL inesperada en prueba H01: ${sql}`);
        },
      };
    }

    const demoFer19Company = {
      id_cliente: 1,
      tipo_cliente: 'EMPRESA',
      activo: 1,
      estado_aprobacion_empresa: 'APROBADA',
      es_fiel: 1,
      email: 'fer19-empresa30@example.test',
    };
    const demoFer19Account = { id_cuenta_corriente: 101, id_cliente: 1, origen_datos: 'DEMO' };

    const realCompanyWithRealAccount = {
      id_cliente: 2,
      tipo_cliente: 'EMPRESA',
      activo: 1,
      estado_aprobacion_empresa: 'APROBADA',
      es_fiel: 1,
      email: 'compras@real-con-cc.com.ar',
    };
    const realAccount = { id_cuenta_corriente: 102, id_cliente: 2, origen_datos: 'REAL' };

    const realCompanyWithoutAccount = {
      id_cliente: 3,
      tipo_cliente: 'EMPRESA',
      activo: 1,
      estado_aprobacion_empresa: 'APROBADA',
      es_fiel: 1,
      email: 'compras@real-sin-cc.com.ar',
    };

    const realApprovedNotLoyalCompany = {
      id_cliente: 4,
      tipo_cliente: 'EMPRESA',
      activo: 1,
      estado_aprobacion_empresa: 'APROBADA',
      es_fiel: 0,
      email: 'compras@real-no-fiel.com.ar',
    };
    const realAccountNotLoyal = { id_cuenta_corriente: 104, id_cliente: 4, origen_datos: 'REAL' };

    // 1. Empresa DEMO estilo FER-19 (correo sin @demo.local, es_fiel = 1, CC origen_datos = 'DEMO') -> excluida (0)
    const demoOnly = await origQueryAggregates(
      createSqlEvaluatingManager({
        clientes: [demoFer19Company],
        cuentas: [demoFer19Account],
        pedidos: [
          {
            id_pedido: 10,
            id_cliente: 1,
            estado: 'CONFIRMADO',
            modalidad_pago: 'TRANSFERENCIA',
            evidencia_total_usd: null,
          },
        ],
        comprobantes: [
          {
            id_comprobante: 'cp-demo-1',
            id_cliente: 1,
            id_pedido: 10,
            id_cuenta_corriente: null,
            id_admin_revision: null,
          },
        ],
      }),
    );
    assert.equal(demoOnly.empresasFieles, 0, 'Empresa DEMO FER-19 con es_fiel=1 debe quedar excluida');
    assert.equal(demoOnly.pedidosPorEstado.totalOperativos, 0, 'Pedido TRANSFERENCIA de cliente con cuenta DEMO debe quedar excluido');
    assert.equal(demoOnly.comprobantesTotales, 0, 'Comprobante de pedido de cliente con cuenta DEMO debe quedar excluido');

    // 2. Empresa real fiel CON cuenta corriente REAL -> contabilizada (1)
    const realWithAccount = await origQueryAggregates(
      createSqlEvaluatingManager({
        clientes: [realCompanyWithRealAccount],
        cuentas: [realAccount],
      }),
    );
    assert.equal(realWithAccount.empresasFieles, 1, 'Empresa real fiel con cuenta REAL debe contabilizarse');

    // 3. Empresa real fiel SIN cuenta corriente (cc IS NULL) -> contabilizada (1)
    const realWithoutAccount = await origQueryAggregates(
      createSqlEvaluatingManager({
        clientes: [realCompanyWithoutAccount],
        cuentas: [],
      }),
    );
    assert.equal(realWithoutAccount.empresasFieles, 1, 'Empresa real fiel sin cuenta corriente debe contabilizarse');

    // 4. Empresa real aprobada con es_fiel = 0 -> no contabilizada (0)
    const notLoyal = await origQueryAggregates(
      createSqlEvaluatingManager({
        clientes: [realApprovedNotLoyalCompany],
        cuentas: [realAccountNotLoyal],
      }),
    );
    assert.equal(notLoyal.empresasFieles, 0, 'Empresa real aprobada con es_fiel=0 no debe contabilizarse');

    // Escenario combinado: solo cuentan las 2 empresas reales fieles (con CC REAL y sin CC)
    const combined = await origQueryAggregates(
      createSqlEvaluatingManager({
        clientes: [
          demoFer19Company,
          realCompanyWithRealAccount,
          realCompanyWithoutAccount,
          realApprovedNotLoyalCompany,
        ],
        cuentas: [demoFer19Account, realAccount, realAccountNotLoyal],
        pedidos: [
          {
            id_pedido: 10,
            id_cliente: 1,
            estado: 'CONFIRMADO',
            modalidad_pago: 'TRANSFERENCIA',
            evidencia_total_usd: null,
          },
          {
            id_pedido: 11,
            id_cliente: 2,
            estado: 'CONFIRMADO',
            modalidad_pago: 'CUENTA_CORRIENTE',
            evidencia_total_usd: null,
          },
          {
            id_pedido: 12,
            id_cliente: 3,
            estado: 'EN_PREPARACION',
            modalidad_pago: 'TRANSFERENCIA',
            evidencia_total_usd: null,
          },
        ],
        comprobantes: [
          {
            id_comprobante: 'cp-demo-1',
            id_cliente: 1,
            id_pedido: 10,
            id_cuenta_corriente: null,
            id_admin_revision: null,
          },
          {
            id_comprobante: 'cp-real-1',
            id_cliente: 3,
            id_pedido: 12,
            id_cuenta_corriente: null,
            id_admin_revision: null,
          },
        ],
      }),
    );
    assert.equal(combined.empresasFieles, 2);
    assert.equal(combined.pedidosPorEstado.totalOperativos, 2);
    assert.equal(combined.pedidosCuentaCorriente, 1);
    assert.equal(combined.comprobantesTotales, 1);
    assert.equal(combined.comprobantesSinRevisar, 1);
  });
});