const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const ts = require('typescript');

const root = path.resolve(__dirname, '../src');

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setImmediate(r));
    await vue.nextTick();
  }
};

function load(file, mocks = {}) {
  const filename = path.resolve(root, file);
  let source = fs.readFileSync(filename, 'utf8');
  if (file.endsWith('.vue')) {
    source = compileScript(parse(source, { filename }).descriptor, { id: 'clients-filters-test' }).content;
  }
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    name => (name in mocks ? mocks[name] : require(name)),
    mod,
    mod.exports,
  );
  return mod.exports;
}

function makeRoute(query = {}) {
  const route = vue.reactive({ query: { ...query }, hash: '' });
  const router = {
    async replace(location) {
      await Promise.resolve();
      route.query = { ...(location?.query ?? {}) };
    },
    async push(location) {
      await Promise.resolve();
      route.query = { ...(location?.query ?? {}) };
    },
  };
  return { route, router };
}

const clients = Array.from({ length: 25 }, (_value, index) => ({
  id: index + 1,
  nombreRazonSocial: `Cliente ${String(index + 1).padStart(2, '0')}`,
  email: `cliente${index + 1}@example.test`,
  fechaRegistro: '2026-11-01T12:00:00.000Z',
  ...(index % 5 === 0 ? {
    tipoCliente: 'EMPRESA',
    estadoAprobacionEmpresa: 'PENDIENTE',
  } : {}),
}));

const page = (overrides = {}) => ({
  clientes: clients.slice(0, 20),
  page: 1,
  limit: 20,
  total: 45,
  totalPages: 3,
  ...overrides,
});

const defaultService = overrides => ({
  getAdminClientPage: async filters => page({ page: filters?.page ?? 1 }),
  getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
  saveAdminClientPriceList: async () => null,
  updateAdminCompanyApproval: async client => client,
  ...overrides,
});

const mutationError = {
  isMutationResultUncertain: error => {
    const status = error?.response?.status;
    return !status || ![400, 401, 403, 404, 409, 422].includes(status);
  },
};

async function mountView(t, { service = defaultService(), route = makeRoute(), query } = {}) {
  if (query) route.route.query = { ...query };
  const auth = vue.reactive({
    user: { id: 1 },
    rol: 'ADMIN',
    sessionVersion: 1,
    isAuthenticated: true,
  });
  const calls = [];
  const wrapped = {
    ...service,
    getAdminClientPage: (filters, signal) => {
      calls.push({ filters, signal });
      return service.getAdminClientPage(filters, signal);
    },
  };
  const component = load('views/admin/AdminClientsView.vue', {
    '@/services/adminClientService': wrapped,
    '@/services/adminMutationError': mutationError,
    '@/stores/auth': { useAuthStore: () => auth },
    'vue-router': {
      useRoute: () => route.route,
      useRouter: () => route.router,
    },
    './AdminPriceListsPanel.vue': { __esModule: true, default: { render: () => null } },
    '@/components/AdminClientCreditStatus.vue': { __esModule: true, default: { render: () => null } },
    '@/components/AdminClientStatusDialog.vue': { __esModule: true, default: { render: () => null } },
    '@/composables/useAdminClientCredit': { useAdminClientCredit: () => ({ status: () => null, refresh: async () => {} }) },
  }).default;
  component.render = () => null;
  const app = vue.createRenderer({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    patchProp() {},
    parentNode: () => null,
    nextSibling: () => null,
  }).createApp(component);
  app.mount({});
  t.after(() => app.unmount());
  await settle();
  return { state: app._instance.setupState, route, auth, calls, service: wrapped };
}

function axiosError(status, message = 'error') {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: status ? { status, data: { message } } : undefined,
  });
}

test('getAdminClientPage envía filtros, límites y señal de cancelación', async () => {
  const calls = [];
  const api = {
    get: async (...args) => {
      calls.push(args);
      return {
        data: {
          message: 'ok',
          data: {
            clientes: clients.slice(0, 2),
            paginacion: { page: 2, limit: 20, total: 45, totalPages: 3 },
          },
        },
      };
    },
  };
  const service = load('services/adminClientService.ts', {
    '@/services/api': { __esModule: true, default: api },
  });
  const controller = new AbortController();
  const result = await service.getAdminClientPage({
    page: 2,
    limit: 20,
    busqueda: '  Constructora  ',
    tipo: 'EMPRESA',
    estadoEmpresa: 'APROBADA',
  }, controller.signal);

  assert.deepEqual(calls, [[
    '/admin/clientes',
    {
      params: {
        page: 2,
        limit: 20,
        busqueda: '  Constructora  ',
        tipo: 'EMPRESA',
        estadoEmpresa: 'APROBADA',
      },
      signal: controller.signal,
    },
  ]]);
  assert.equal(result.page, 2);
  assert.equal(result.total, 45);
  assert.equal(result.totalPages, 3);
  assert.equal(result.clientes.length, 2);
});

test('la vista pagina desde backend, expone el resumen y conserva búsqueda y filtros', async t => {
  const { state, route } = await mountView(t, {
    query: { busqueda: 'Cliente', tipo: 'EMPRESA', page: '2' },
  });

  assert.equal(state.clients.length, 20);
  assert.equal(state.total, 45);
  assert.equal(state.totalPages, 3);
  assert.equal(state.from, 21);
  assert.equal(state.to, 40);
  assert.equal(route.route.query.busqueda, 'Cliente');
  assert.equal(route.route.query.tipo, 'EMPRESA');

  state.changePage(-1);
  await settle();
  assert.equal(route.route.query.page, undefined);
  assert.equal(route.route.query.busqueda, 'Cliente');
  assert.equal(route.route.query.tipo, 'EMPRESA');

  state.changeTipo({ target: { value: 'PARTICULAR' } });
  await settle();
  assert.equal(route.route.query.page, undefined);
  assert.equal(route.route.query.tipo, 'PARTICULAR');
  assert.equal(route.route.query.estadoEmpresa, undefined);
  assert.equal(route.route.query.busqueda, 'Cliente');
});

test('seleccionar estado de empresa fuerza tipo Empresa y quitarlo limpia ambos', async t => {
  const { state, route } = await mountView(t, { query: { page: '3' } });

  state.changeEstado({ target: { value: 'APROBADA' } });
  await settle();
  assert.equal(route.route.query.tipo, 'EMPRESA');
  assert.equal(route.route.query.estadoEmpresa, 'APROBADA');
  assert.equal(route.route.query.page, undefined);

  state.changeEstado({ target: { value: '' } });
  await settle();
  assert.equal(route.route.query.tipo, undefined);
  assert.equal(route.route.query.estadoEmpresa, undefined);
});

test('una respuesta anterior no sobrescribe la búsqueda vigente', async t => {
  const requests = [];
  const service = defaultService({
    getAdminClientPage: (filters, signal) => new Promise((resolve, reject) => {
      requests.push({ filters, signal, resolve, reject });
    }),
  });
  const { state, route, calls } = await mountView(t, { service });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].filters.page, 1);

  await route.router.replace({ query: { busqueda: 'Constructora', page: '1' } });
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].filters.busqueda, 'Constructora');

  requests[1].resolve(page({
    clientes: [clients[1]],
    page: 1,
    total: 1,
    totalPages: 1,
  }));
  await settle();
  assert.deepEqual(state.clients.map(client => client.id), [2]);

  requests[0].resolve(page());
  await settle();
  assert.deepEqual(state.clients.map(client => client.id), [2]);
  assert.equal(state.isLoading, false);
});

test('distingue sin clientes, sin resultados y error de consulta', async t => {
  const empty = await mountView(t, {
    service: defaultService({
      getAdminClientPage: async () => page({ clientes: [], total: 0, totalPages: 0 }),
    }),
  });
  assert.equal(empty.state.pageData.total, 0);
  assert.equal(empty.state.hasActiveFilters, false);

  const emptyFiltered = await mountView(t, {
    query: { busqueda: 'sin-coincidencias' },
    service: defaultService({
      getAdminClientPage: async () => page({ clientes: [], total: 0, totalPages: 0 }),
    }),
  });
  assert.equal(emptyFiltered.state.pageData.total, 0);
  assert.equal(emptyFiltered.state.hasActiveFilters, true);

  const failed = await mountView(t, {
    service: defaultService({
      getAdminClientPage: async () => {
        throw axiosError(500, 'Listado temporalmente inaccesible.');
      },
    }),
  });
  assert.equal(failed.state.pageData, null);
  assert.equal(failed.state.loadError, 'Listado temporalmente inaccesible.');
  assert.equal(failed.state.isLoading, false);
});

test('al cambiar de sesión se descartan datos y respuestas pendientes', async t => {
  let resolveOld;
  const { state, auth } = await mountView(t, {
    service: defaultService({
      getAdminClientPage: () => new Promise(resolve => { resolveOld = resolve; }),
    }),
    query: { busqueda: 'Cliente' },
  });

  auth.user = null;
  auth.sessionVersion = 2;
  await settle();
  assert.equal(state.clients.length, 0);
  assert.equal(state.priceLists.length, 0);
  assert.equal(state.pageData, null);

  resolveOld?.(page());
  await settle();
  assert.equal(state.clients.length, 0);
});

test('resultado incierto de lista se reconcilia con el servidor antes de habilitar otra escritura', async t => {
  let reads = 0;
  const list = (id, nombre) => ({
    idListaPrecio: id,
    nombre,
    activa: true,
    idCliente: 1,
  });
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      return {
        listas: [
          { id: 1, nombre: 'Lista uno', porcentajeDescuento: '10.00' },
          { id: 2, nombre: 'Lista dos', porcentajeDescuento: '20.00' },
        ],
        asignaciones: [reads === 1 ? list(1, 'Lista uno') : list(2, 'Lista dos')],
      };
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(undefined, 'timeout');
    },
  });
  const { state } = await mountView(t, { service });
  assert.equal(state.assignments[1].idListaPrecio, 1);
  state.selections[1] = 2;

  await state.savePriceList(1);
  await settle();

  assert.equal(reads, 2);
  assert.equal(state.savingClientId, null);
  assert.equal(state.assignments[1].idListaPrecio, 2);
  assert.equal(state.selections[1], 2);
  assert.deepEqual(state.feedback[1], {
    text: 'Cambio confirmado con el servidor.',
    error: false,
  });
  assert.equal(state.priceListsError, null);
  assert.equal(state.uncertainPriceListClientIds[1], undefined);
});

test('una recarga de listas por edición no descarta una asignación todavía no guardada', async t => {
  const service = defaultService({
    getAdminClientPriceLists: async () => ({
      listas: [
        { id: 1, nombre: 'Lista uno', porcentajeDescuento: '10.00' },
        { id: 2, nombre: 'Lista dos', porcentajeDescuento: '20.00' },
      ],
      asignaciones: [{ idListaPrecio: 1, nombre: 'Lista uno', activa: true, idCliente: 1 }],
    }),
  });
  const { state } = await mountView(t, { service });
  state.selections[1] = 2;

  await state.loadPriceLists(true);
  await settle();
  assert.equal(state.selections[1], 2);

  await state.loadPriceLists(false);
  await settle();
  assert.equal(state.selections[1], 1);
});

test('si la reconciliación de lista falla, bloquea la asignación sin mostrar éxito', async t => {
  let reads = 0;
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      if (reads > 1) throw axiosError(undefined, 'offline');
      return {
        listas: [
          { id: 1, nombre: 'Lista uno', porcentajeDescuento: '10.00' },
          { id: 2, nombre: 'Lista dos', porcentajeDescuento: '20.00' },
        ],
        asignaciones: [{ idListaPrecio: 1, nombre: 'Lista uno', activa: true, idCliente: 1 }],
      };
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(500, 'detalle interno');
    },
  });
  const { state } = await mountView(t, { service });
  state.selections[1] = 2;

  await state.savePriceList(1);
  await settle();

  assert.equal(state.savingClientId, null);
  assert.equal(state.assignments[1].idListaPrecio, 1);
  assert.equal(state.uncertainPriceListClientIds[1], true);
  assert.match(state.priceListsError, /No pudimos verificar las asignaciones/);
  assert.equal(state.feedback[1].error, true);
  assert.match(state.feedback[1].text, /No pudimos verificar el resultado/);
  assert.equal(state.canSavePriceList(1), false);
});

test('regresión #345+#346: aprobar en una página filtrada conserva URL y una respuesta paginada obsoleta no pisa el estado', async t => {
  let resolveStale;
  const service = defaultService({
    getAdminClientPage: filters => {
      if (filters.page === 1) {
        return new Promise(resolve => { resolveStale = resolve; });
      }
      return Promise.resolve(page({
        clientes: clients.slice(0, 20),
        page: 2,
        total: 45,
        totalPages: 3,
      }));
    },
    updateAdminCompanyApproval: async (id, estado) => ({
      ...clients[0],
      id,
      estadoAprobacionEmpresa: estado,
    }),
  });
  const { state, route } = await mountView(t, {
    service,
    query: { busqueda: 'Cliente', tipo: 'EMPRESA', estadoEmpresa: 'PENDIENTE', page: '2' },
  });

  const empresa = state.clients[0];
  assert.equal(empresa.id, 1);
  assert.equal(empresa.estadoAprobacionEmpresa, 'PENDIENTE');
  assert.equal(state.pageData.page, 2);

  // Inicia una lectura de la página 1 que quedará pendiente y luego aprueba la
  // empresa desde la página 2.
  state.changePage(-1);
  await settle();
  await state.setCompanyApproval(empresa, 'APROBADA');
  assert.equal(empresa.estadoAprobacionEmpresa, 'APROBADA');
  assert.equal(route.route.query.busqueda, 'Cliente');
  assert.equal(route.route.query.tipo, 'EMPRESA');
  assert.equal(route.route.query.estadoEmpresa, 'PENDIENTE');

  // La respuesta de listado iniciada antes de la mutación trae el estado viejo.
  resolveStale(page({
    clientes: [{ ...clients[0], estadoAprobacionEmpresa: 'PENDIENTE' }],
    page: 1,
    total: 1,
    totalPages: 1,
  }));
  await settle();

  assert.equal(state.pageData.page, 1);
  assert.equal(state.clients[0].id, 1);
  assert.equal(state.clients[0].estadoAprobacionEmpresa, 'APROBADA');
  assert.equal(route.route.query.busqueda, 'Cliente');
  assert.equal(route.route.query.tipo, 'EMPRESA');
  assert.equal(route.route.query.estadoEmpresa, 'PENDIENTE');
  assert.equal(route.route.query.page, undefined);
});

test('AUD-346-01: loadPriceLists(true) conserva el borrador pendiente en un cliente sin asignación previa', async t => {
  let lists = [
    { id: 1, nombre: 'Lista uno', porcentajeDescuento: '10.00' },
    { id: 2, nombre: 'Lista dos', porcentajeDescuento: '20.00' },
  ];
  const service = defaultService({
    getAdminClientPriceLists: async () => ({
      listas: lists,
      asignaciones: [{ idListaPrecio: 1, nombre: 'Lista uno', activa: true, idCliente: 1 }],
    }),
  });
  const { state } = await mountView(t, { service });
  assert.equal(state.assignments[2], undefined);
  state.selections[2] = 2;

  await state.loadPriceLists(true);
  await settle();
  assert.equal(state.selections[2], 2);

  lists = [{ id: 1, nombre: 'Lista uno', porcentajeDescuento: '10.00' }];
  await state.loadPriceLists(true);
  await settle();
  assert.equal(state.selections[2], undefined);
});

const priceLists346 = [
  { id: 1, nombre: 'Lista X', porcentajeDescuento: '10.00' },
  { id: 2, nombre: 'Lista Y', porcentajeDescuento: '20.00' },
  { id: 3, nombre: 'Lista Z', porcentajeDescuento: '30.00' },
];
const assigned346 = (idCliente, idListaPrecio, nombre = `Lista ${idListaPrecio}`) => ({
  idCliente,
  idListaPrecio,
  nombre,
  activa: true,
});

test('S7-346-R01: reconciliar la lista de B conserva el borrador de A y no escribe sobre A', async t => {
  let reads = 0;
  const writes = [];
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      return {
        listas: priceLists346,
        asignaciones: reads === 1
          ? [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X'), assigned346(3, 1, 'Lista X')]
          : [assigned346(1, 1, 'Lista X'), assigned346(2, 3, 'Lista Z'), assigned346(3, 1, 'Lista X')],
      };
    },
    saveAdminClientPriceList: async (id, idListaPrecio) => {
      writes.push([id, idListaPrecio]);
      throw axiosError(undefined, 'respuesta perdida');
    },
  });
  const { state, route } = await mountView(t, {
    service,
    query: { busqueda: 'Cliente', tipo: 'EMPRESA', estadoEmpresa: 'PENDIENTE', page: '2' },
  });

  // A tiene un borrador sin guardar; B está a punto de guardar el suyo.
  state.selections[1] = 2;
  state.selections[2] = 3;
  state.feedback[3] = { text: 'Aviso independiente de otra fila.', error: true };
  state.uncertainPriceListClientIds[3] = true;

  await state.savePriceList(2);
  await settle();

  assert.equal(reads, 2);
  assert.deepEqual(writes, [[2, 3]]);
  assert.equal(state.assignments[2].idListaPrecio, 3);
  assert.equal(state.selections[2], 3);
  assert.deepEqual(state.feedback[2], {
    text: 'Cambio confirmado con el servidor.',
    error: false,
  });
  assert.equal(state.selections[1], 2, 'el borrador de A debe conservarse');
  assert.equal(state.assignments[1].idListaPrecio, 1);
  assert.equal(state.canSavePriceList(1), true, 'A debe poder guardar su borrador');
  assert.equal(state.uncertainPriceListClientIds[1], undefined);
  assert.deepEqual(state.feedback[3], { text: 'Aviso independiente de otra fila.', error: true });
  assert.equal(state.uncertainPriceListClientIds[3], true);
  assert.equal(route.route.query.busqueda, 'Cliente');
  assert.equal(route.route.query.tipo, 'EMPRESA');
  assert.equal(route.route.query.estadoEmpresa, 'PENDIENTE');
  assert.equal(route.route.query.page, '2');
});

test('S7-346-R01: la reconciliación conserva «Sin lista» y actualiza filas sin borrador', async t => {
  let reads = 0;
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      return {
        listas: priceLists346,
        asignaciones: reads === 1
          ? [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X'), assigned346(3, 1, 'Lista X')]
          : [assigned346(1, 1, 'Lista X'), assigned346(2, 3, 'Lista Z'), assigned346(3, 2, 'Lista Y')],
      };
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(undefined, 'respuesta perdida');
    },
  });
  const { state } = await mountView(t, { service });

  state.selections[1] = '';
  state.selections[2] = 3;
  state.selections[3] = 1;

  await state.savePriceList(2);
  await settle();

  assert.equal(state.selections[2], 3);
  assert.equal(state.selections[1], '', 'el borrador «Sin lista» de A debe conservarse');
  assert.equal(state.assignments[1].idListaPrecio, 1);
  assert.equal(state.canSavePriceList(1), true);
  assert.equal(state.selections[3], 2, 'la fila sin borrador refleja el servidor');
  assert.equal(state.assignments[3].idListaPrecio, 2);
  assert.equal(state.canSavePriceList(3), false);
});

test('S7-346-R01: un borrador hacia una lista desactivada no se restaura al reconciliar', async t => {
  let reads = 0;
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      return {
        listas: reads === 1
          ? priceLists346
          : priceLists346.filter(list => list.id !== 3),
        asignaciones: reads === 1
          ? [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X')]
          : [assigned346(1, 1, 'Lista X'), assigned346(2, 2, 'Lista Y')],
      };
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(undefined, 'respuesta perdida');
    },
  });
  const { state } = await mountView(t, { service });

  state.selections[1] = 3;
  state.selections[2] = 2;

  await state.savePriceList(2);
  await settle();

  assert.equal(state.selections[2], 2);
  assert.equal(state.selections[1], 1, 'el borrador inválido cae a la asignación vigente');
  assert.equal(state.assignments[1].idListaPrecio, 1);
  assert.equal(state.canSavePriceList(1), false);
});

test('S7-346-R01: si falla la lectura de reconciliación, conserva el borrador de A y bloquea solo a B', async t => {
  let reads = 0;
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      if (reads > 1) throw axiosError(undefined, 'offline');
      return {
        listas: priceLists346,
        asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X')],
      };
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(500, 'detalle interno');
    },
  });
  const { state } = await mountView(t, { service });

  state.selections[1] = 2;
  state.selections[2] = 3;
  state.feedback[1] = { text: 'Aviso de A.', error: false };

  await state.savePriceList(2);
  await settle();

  assert.equal(state.selections[1], 2);
  assert.equal(state.selections[2], 3);
  assert.equal(state.uncertainPriceListClientIds[2], true);
  assert.equal(state.uncertainPriceListClientIds[1], undefined);
  assert.deepEqual(state.feedback[1], { text: 'Aviso de A.', error: false });
  assert.equal(state.feedback[2].error, true);
  assert.match(state.priceListsError, /No pudimos verificar las asignaciones/);
});

test('S7-346-R01: una respuesta tardía de reconciliación no pisa cambios posteriores', async t => {
  let reads = 0;
  let resolveReconciliation;
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      if (reads === 1) {
        return {
          listas: priceLists346,
          asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X')],
        };
      }
      return new Promise(resolve => { resolveReconciliation = resolve; });
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(undefined, 'respuesta perdida');
    },
  });
  const { state } = await mountView(t, { service });

  state.selections[1] = 2;
  state.selections[2] = 3;
  const saving = state.savePriceList(2);
  await settle();

  // Cambios realizados después de iniciar la lectura de reconciliación.
  state.selections[1] = 3;
  state.selections[2] = 2;
  resolveReconciliation({
    listas: priceLists346,
    asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 3, 'Lista Z')],
  });
  await saving;
  await settle();

  assert.equal(state.assignments[2].idListaPrecio, 3, 'la asignación autoritativa de B se actualiza');
  assert.equal(state.selections[2], 2, 'el cambio posterior de B no se pisa');
  assert.equal(state.selections[1], 3, 'el cambio posterior de A no se pisa');
  assert.equal(state.uncertainPriceListClientIds[2], undefined);
  assert.equal(state.savingClientId, null);
});

test('S7-346-R01: una reconciliación obsoleta no pisa una recarga posterior', async t => {
  let reads = 0;
  let resolveReconciliation;
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      if (reads === 1) {
        return {
          listas: priceLists346,
          asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X')],
        };
      }
      if (reads === 2) return new Promise(resolve => { resolveReconciliation = resolve; });
      return {
        listas: priceLists346,
        asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 2, 'Lista Y')],
      };
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(undefined, 'respuesta perdida');
    },
  });
  const { state } = await mountView(t, { service });

  state.selections[2] = 3;
  const saving = state.savePriceList(2);
  await settle();
  await state.loadPriceLists(false);
  await settle();

  resolveReconciliation({
    listas: priceLists346,
    asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 3, 'Lista Z')],
  });
  await saving;
  await settle();

  assert.equal(state.assignments[2].idListaPrecio, 2);
  assert.equal(state.selections[2], 2);
  assert.equal(state.feedback[2], undefined);
});

test('S7-346-R01: un cambio de sesión descarta la reconciliación en curso', async t => {
  let resolveReconciliation;
  let reads = 0;
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      if (reads === 1) {
        return {
          listas: priceLists346,
          asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X')],
        };
      }
      return new Promise(resolve => { resolveReconciliation = resolve; });
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(undefined, 'respuesta perdida');
    },
  });
  const { state, auth } = await mountView(t, { service });

  state.selections[1] = 2;
  state.selections[2] = 3;
  const saving = state.savePriceList(2);
  await settle();

  auth.user = null;
  auth.sessionVersion = 2;
  await settle();
  resolveReconciliation({
    listas: priceLists346,
    asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 3, 'Lista Z')],
  });
  await saving;
  await settle();

  assert.deepEqual(state.assignments, {});
  assert.deepEqual(state.selections, {});
  assert.deepEqual(state.feedback, {});
  assert.deepEqual(state.uncertainPriceListClientIds, {});
  assert.equal(state.priceLists.length, 0);
});


test('AUD-346-02: el debounce de búsqueda preserva el espacio final mientras el input sigue enfocado', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { state, route } = await mountView(t);

  state.searchInput = { matches: selector => selector === ':focus' };
  state.searchQuery = 'Juan ';
  await settle();
  t.mock.timers.tick(300);
  await settle();

  assert.equal(route.route.query.busqueda, 'Juan');
  assert.equal(state.searchQuery, 'Juan ');

  state.searchInput = { matches: () => false };
  state.searchQuery = 'Pedro ';
  await settle();
  t.mock.timers.tick(300);
  await settle();

  assert.equal(route.route.query.busqueda, 'Pedro');
  assert.equal(state.searchQuery, 'Pedro');
});

test('AUD-346-03: navegar filtros o página por historial cierra el diálogo abierto', async t => {
  const { state, route } = await mountView(t);
  const empresa = state.clients.find(c => c.tipoCliente === 'EMPRESA');
  state.openClient(empresa, 'APROBADA');
  assert.equal(state.selectedClientId, empresa.id);
  assert.equal(state.approvalTarget, 'APROBADA');

  route.route.query = { page: '2' };
  await settle();

  assert.equal(state.selectedClientId, null);
  assert.equal(state.approvalTarget, null);
});

test('S7-346-R02: si la reconciliación confirma que el servidor conservó la asignación anterior, informa error y conserva otros borradores', async t => {
  const service = defaultService({
    getAdminClientPriceLists: async () => ({
      listas: priceLists346,
      asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X')],
    }),
    saveAdminClientPriceList: async () => {
      throw axiosError(undefined, 'respuesta perdida');
    },
  });
  const { state } = await mountView(t, { service });

  state.selections[1] = 2;
  state.selections[2] = 3;

  await state.savePriceList(2);
  await settle();

  assert.equal(state.assignments[2].idListaPrecio, 1);
  assert.equal(state.selections[2], 1);
  assert.deepEqual(state.feedback[2], {
    text: 'El servidor conserva la asignación anterior.',
    error: true,
  });
  assert.equal(state.selections[1], 2, 'el borrador de otra fila debe conservarse');
  assert.equal(state.canSavePriceList(1), true);
  assert.equal(state.uncertainPriceListClientIds[2], undefined);
  assert.equal(state.savingClientId, null);
});

test('S7-346-R02: si el operador cambia la selección durante la lectura de reconciliación, limpia el feedback y no pisa su nueva edición', async t => {
  let reads = 0;
  let resolveReconciliation;
  const service = defaultService({
    getAdminClientPriceLists: async () => {
      reads += 1;
      if (reads === 1) {
        return {
          listas: priceLists346,
          asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X')],
        };
      }
      return new Promise(resolve => { resolveReconciliation = resolve; });
    },
    saveAdminClientPriceList: async () => {
      throw axiosError(undefined, 'respuesta perdida');
    },
  });
  const { state } = await mountView(t, { service });

  state.selections[1] = 2;
  state.selections[2] = 3;
  const saving = state.savePriceList(2);
  await settle();

  // El operador cambia el selector de la fila reconciliada mientras la lectura está en curso.
  state.selections[2] = 2;
  resolveReconciliation({
    listas: priceLists346,
    asignaciones: [assigned346(1, 1, 'Lista X'), assigned346(2, 1, 'Lista X')],
  });
  await saving;
  await settle();

  assert.equal(state.assignments[2].idListaPrecio, 1);
  assert.equal(state.selections[2], 2, 'la nueva edición concurrente no debe pisarse');
  assert.equal(state.feedback[2], undefined, 'el feedback obsoleto debe limpiarse');
  assert.equal(state.selections[1], 2);
  assert.equal(state.uncertainPriceListClientIds[2], undefined);
  assert.equal(state.savingClientId, null);
});
