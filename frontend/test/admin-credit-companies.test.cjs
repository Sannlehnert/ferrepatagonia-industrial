const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(name => dependencies[name] ?? require(name), mod, mod.exports)
  return mod.exports
}

const dto = load('services/adminCreditCompanyDto')

const company = {
  clienteId: 7,
  nombreRazonSocial: 'Metalúrgica Sur S.A.',
  cuit: '30-71234567-9',
  email: 'compras@metalurgica.test',
  estadoAprobacionEmpresa: 'APROBADA',
  activo: true,
  cuentaCorriente: {
    cuentaId: 11,
    estado: 'INHABILITADA',
    limite: '1500.00',
    moneda: 'USD',
    plazoDias: 30,
    cobertura: 'COMPLETA',
    origen: 'REAL',
  },
  solicitudCredito: {
    id: 21,
    estado: 'APROBADA',
    montoSolicitado: '1200.00',
    plazoDias: 30,
    fechaSolicitud: '2026-11-20T12:00:00.000000Z',
    fechaResolucion: '2026-11-21T09:30:00.000Z',
    limiteAutorizado: '1500.00',
    plazoAutorizado: 30,
  },
}
const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 }
const page = { data: { empresas: [company], paginacion: pagination } }

test('decodifica empresas sin inventar cuenta ni solicitud', () => {
  assert.deepEqual(dto.decodeAdminCreditCompanyPage(page), { empresas: [company], paginacion: pagination })
  const empty = dto.decodeAdminCreditCompanyPage({
    data: {
      empresas: [{ ...company, cuentaCorriente: null, solicitudCredito: null }],
      paginacion: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  })
  assert.equal(empty.empresas[0].cuentaCorriente, null)
  assert.equal(empty.empresas[0].solicitudCredito, null)
  assert.equal(dto.decodeAdminCreditCompany({ data: { empresa: company } }).clienteId, 7)
})

for (const changes of [
  { clienteId: '7' },
  { nombreRazonSocial: '' },
  { cuentaCorriente: { ...company.cuentaCorriente, limite: 1500 } },
  { cuentaCorriente: { ...company.cuentaCorriente, estado: 'OTRA' } },
  { solicitudCredito: { ...company.solicitudCredito, estado: 'OTRA' } },
  { solicitudCredito: { ...company.solicitudCredito, fechaSolicitud: '20/11/2026' } },
  { estadoAprobacionEmpresa: 'OTRA' },
]) {
  test(`rechaza respuesta no contractual ${JSON.stringify(changes)}`, () => {
    assert.throws(() => dto.decodeAdminCreditCompanyPage({
      data: { empresas: [{ ...company, ...changes }], paginacion },
    }))
  })
}

test('decodifica eventos de auditoría sin aceptar tipos desconocidos', () => {
  const event = {
    id: '5', clienteId: 7, solicitudId: 21, cuentaId: 11,
    tipo: 'LIMITE_MODIFICADO', actorUsuarioId: 1, rolActor: 'ADMIN',
    estadoAnterior: 'INHABILITADA', estadoNuevo: 'INHABILITADA',
    limiteAnterior: '1200.00', limiteNuevo: '1500.00', moneda: 'USD',
    motivo: 'Ampliación', evidencia: 'ACTA-1500', revisionCuenta: '12',
    fechaEvento: '2026-11-21T09:30:00.000Z',
  }
  const decoded = dto.decodeAdminCreditEventPage({ data: { items: [event], siguienteAntesDeId: null } })
  assert.deepEqual(decoded, { items: [event], siguienteAntesDeId: null })
  assert.throws(() => dto.decodeAdminCreditEventPage({
    data: { items: [{ ...event, tipo: 'EVENTO_AJENO' }], siguienteAntesDeId: null },
  }))
})

test('servicio usa las rutas administrativas, filtros y AbortSignal', async () => {
  const calls = []
  const controller = new AbortController()
  const api = {
    get: async (url, options) => {
      calls.push({ url, options })
      return { data: { data: 'raw' } }
    },
  }
  const service = load('services/adminCreditCompanyService', {
    './api': { __esModule: true, default: api },
    './adminCreditCompanyDto': {
      decodeAdminCreditCompanyPage: value => value,
      decodeAdminCreditCompany: value => value,
      decodeAdminCreditEventPage: value => value,
    },
  })

  await service.listAdminCreditCompanies({
    busqueda: 'Metalúrgica',
    estadoEmpresa: 'APROBADA',
    estadoSolicitud: 'PENDIENTE',
    cuenta: 'INHABILITADA',
    page: 2,
    limit: 10,
  }, controller.signal)
  await service.getAdminCreditCompany(7, controller.signal)
  await service.listAdminCreditEvents({ clienteId: 7, limite: 50 }, controller.signal)

  assert.deepEqual(calls.map(call => call.url), [
    '/admin/credito/empresas',
    '/admin/credito/empresas/7',
    '/admin/credito/eventos',
  ])
  assert.deepEqual(calls[0].options.params, {
    page: 2,
    limit: 10,
    busqueda: 'Metalúrgica',
    estadoEmpresa: 'APROBADA',
    estadoSolicitud: 'PENDIENTE',
    cuenta: 'INHABILITADA',
  })
  assert.deepEqual(calls[2].options.params, { clienteId: 7, limite: 50 })
  assert.ok(calls.every(call => call.options.signal === controller.signal))
})
