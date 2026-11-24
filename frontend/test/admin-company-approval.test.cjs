const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const ts = require('typescript');

const root = path.resolve(__dirname, '../src');

function createTestRenderer() {
  const node = (tag, text = '') => ({
    tag,
    text,
    props: {},
    children: [],
    parent: null,
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    matches() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getClientRects() { return []; },
    contains() { return false; },
    get isConnected() {
      let current = this;
      while (current.parent) current = current.parent;
      return current.tag === 'root';
    },
  });
  return {
    createRoot: () => node('root'),
    serialize(n) {
      if (n.tag === '#text') return n.text;
      if (n.tag === '#comment') return '';
      const attrs = Object.entries(n.props)
        .filter(([k, v]) => !k.startsWith('on') && v !== undefined && v !== false && v !== null)
        .map(([k, v]) => (v === true ? k : `${k}="${v}"`))
        .join(' ');
      const inner = (n.text || '') + n.children.map(c => this.serialize(c)).join('');
      return n.tag === 'root' ? inner : `<${n.tag}${attrs ? ' ' + attrs : ''}>${inner}</${n.tag}>`;
    },
    renderer: vue.createRenderer({
      createElement: tag => node(tag),
      createText: text => node('#text', text),
      createComment: text => node('#comment', text),
      insert(el, parent, anchor) {
        el.parent = parent;
        const i = anchor ? parent.children.indexOf(anchor) : -1;
        if (i >= 0) parent.children.splice(i, 0, el);
        else parent.children.push(el);
      },
      remove(el) {
        if (!el.parent) return;
        const i = el.parent.children.indexOf(el);
        if (i >= 0) el.parent.children.splice(i, 1);
        el.parent = null;
      },
      setText(el, text) {
        el.text = text;
      },
      setElementText(el, text) {
        el.text = text;
        el.children = [];
      },
      patchProp(el, key, _prev, next) {
        el.props[key] = next;
      },
      parentNode: el => el.parent,
      nextSibling: el => {
        if (!el.parent) return null;
        const i = el.parent.children.indexOf(el);
        return el.parent.children[i + 1] || null;
      },
    }),
  };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setImmediate(r));
    await vue.nextTick();
  }
};

function load(file, mocks = {}, inlineTemplate = false) {
  const defaults = {
    '@/stores/auth': { useAuthStore: () => vue.reactive({ rol: 'ADMIN', user: { id: 1 }, sessionVersion: 1, loggingIn: false, loggingOut: false }) },
    '@/composables/useAdminClientCredit': { useAdminClientCredit: () => ({ status: () => null, refresh: async () => {} }) },
    '@/components/AdminClientCreditStatus.vue': { __esModule: true, default: { render: () => null } },
    '@/components/AdminClientStatusDialog.vue': { __esModule: true, default: {
      emits: ['confirm'],
      setup(_props, { emit }) { return () => vue.h('button', { 'aria-label': 'Confirmar aprobación de prueba', onClick: () => emit('confirm') }, 'Confirmar'); },
    } },
    'vue-router': {
      useRoute: () => vue.reactive({ query: {}, hash: '' }),
      useRouter: () => ({ replace: async () => {}, push: async () => {} }),
    },
    '@/services/adminMutationError': {
      isMutationResultUncertain: error => {
        const status = error?.response?.status;
        return !status || ![400, 401, 403, 404, 409, 422].includes(status);
      },
    },
  };
  mocks = { ...defaults, ...mocks };
  const filename = path.resolve(root, file);
  let source = fs.readFileSync(filename, 'utf8');
  if (file.endsWith('.vue')) {
    const { descriptor } = parse(source, { filename });
    source = compileScript(descriptor, {
      id: 'company-approval-test',
      inlineTemplate,
    }).content;
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

const sampleClients = () => [
  {
    id: 10,
    nombreRazonSocial: 'Ana Particular',
    email: 'ana@example.test',
    fechaRegistro: '2026-11-01T12:00:00.000Z',
  },
  {
    id: 20,
    nombreRazonSocial: 'Constructora Sur SRL',
    email: 'compras@constructorasur.test',
    fechaRegistro: '2026-11-02T15:30:00.000Z',
    tipoCliente: 'EMPRESA',
    cuit: '30-71234567-9',
    estadoAprobacionEmpresa: 'PENDIENTE',
  },
  {
    id: 30,
    nombreRazonSocial: 'Metalúrgica Austral SA',
    email: 'admin@metalurgica.test',
    fechaRegistro: '2026-11-03T10:00:00.000Z',
    tipoCliente: 'EMPRESA',
    cuit: '30-79876543-1',
    estadoAprobacionEmpresa: 'APROBADA',
  },
  {
    id: 40,
    nombreRazonSocial: 'Obras Patagónicas SA',
    email: 'info@obras.test',
    fechaRegistro: '2026-11-04T09:00:00.000Z',
    tipoCliente: 'EMPRESA',
    estadoAprobacionEmpresa: 'RECHAZADA',
  },
];

function clientPage(clients = sampleClients(), overrides = {}) {
  const total = overrides.total ?? clients.length;
  const limit = overrides.limit ?? 20;
  return {
    clientes: clients,
    page: overrides.page ?? 1,
    limit,
    total,
    totalPages: overrides.totalPages ?? (total === 0 ? 0 : Math.ceil(total / limit)),
  };
}

function createRoute(query = {}) {
  const route = vue.reactive({ query: { ...query }, hash: '' });
  const replace = async location => {
    route.query = { ...(location?.query ?? {}) };
    route.hash = location?.hash ?? '';
  };
  const push = async location => { await replace(location); };
  return { route, router: { push, replace } };
}

const mutationError = {
  isMutationResultUncertain: error => {
    const status = error?.response?.status;
    return !status || ![400, 401, 403, 404, 409, 422].includes(status);
  },
};

function clientViewMocks(service, routeState, auth = {
  user: { id: 1 },
  rol: 'ADMIN',
  sessionVersion: 1,
  isAuthenticated: true,
}) {
  return {
    '@/services/adminClientService': service,
    '@/services/adminMutationError': mutationError,
    '@/stores/auth': { useAuthStore: () => auth },
    'vue-router': {
      useRoute: () => routeState.route,
      useRouter: () => routeState.router,
    },
    './AdminPriceListsPanel.vue': { __esModule: true, default: { render: () => null } },
  };
}

test('adminClientService usa PATCH /admin/clientes/:id/estado-empresa y retorna el cliente actualizado', async () => {
  const calls = [];
  const api = {
    get: async (...args) => {
      calls.push(['get', ...args]);
      return { data: { message: 'ok', data: { clientes: sampleClients() } } };
    },
    patch: async (...args) => {
      calls.push(['patch', ...args]);
      return {
        data: {
          message: 'Estado de empresa actualizado correctamente.',
          data: {
            cliente: {
              ...sampleClients()[1],
              estadoAprobacionEmpresa: args[1].estado,
            },
          },
        },
      };
    },
  };

  const service = load('services/adminClientService.ts', {
    '@/services/api': { __esModule: true, default: api },
  });

  const clients = await service.getAdminClients();
  assert.equal(clients.length, 4);

  const approved = await service.updateAdminCompanyApproval(20, 'APROBADA');
  assert.equal(approved.estadoAprobacionEmpresa, 'APROBADA');

  const rejected = await service.updateAdminCompanyApproval(20, 'RECHAZADA');
  assert.equal(rejected.estadoAprobacionEmpresa, 'RECHAZADA');

  assert.deepEqual(calls, [
    ['get', '/admin/clientes'],
    ['patch', '/admin/clientes/20/estado-empresa', { estado: 'APROBADA' }],
    ['patch', '/admin/clientes/20/estado-empresa', { estado: 'RECHAZADA' }],
  ]);
  const controller = new AbortController();
  await service.getAdminClients(controller.signal);
  await service.updateAdminCompanyApproval(20, 'APROBADA', controller.signal, 'PENDIENTE');
  assert.deepEqual(calls.slice(-2), [
    ['get', '/admin/clientes', { signal: controller.signal }],
    ['patch', '/admin/clientes/20/estado-empresa', { estado: 'APROBADA', estadoEsperado: 'PENDIENTE' }, { signal: controller.signal }],
  ]);
});

test('AdminClientsView renderiza tipos, badges PENDIENTE/APROBADA/RECHAZADA y acciones Aprobar/Rechazar', async t => {
  const service = {
    getAdminClientPage: async () => clientPage(),
    getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
    saveAdminClientPriceList: async () => null,
    updateAdminCompanyApproval: async () => sampleClients()[1],
  };
  const routeState = createRoute();

  const component = load(
    'views/admin/AdminClientsView.vue',
    clientViewMocks(service, routeState),
    true,
  ).default;

  const dom = createTestRenderer();
  const rootEl = dom.createRoot();
  const app = dom.renderer.createApp(component);
  app.mount(rootEl);
  t.after(() => app.unmount());
  await settle();

  const tableHtml = dom.serialize(rootEl);
  assert.match(tableHtml, /Particular/);
  assert.match(tableHtml, /Empresa/);
  assert.match(tableHtml, /CUIT: 30-71234567-9/);
  assert.match(tableHtml, /Pendiente/);
  assert.match(tableHtml, /Aprobada/);
  assert.match(tableHtml, /Rechazada/);
  assert.match(tableHtml, /Aprobar cuenta empresa de Constructora Sur SRL/);
  assert.match(tableHtml, /Rechazar cuenta empresa de Constructora Sur SRL/);
  assert.match(tableHtml, /Página 1 de 1/);
  assert.doesNotMatch(tableHtml, /Aprobar cuenta empresa de Metalúrgica Austral SA/);
  assert.match(tableHtml, /Rechazar cuenta empresa de Metalúrgica Austral SA/);
  assert.match(tableHtml, /Aprobar cuenta empresa de Obras Patagónicas SA/);
  assert.doesNotMatch(tableHtml, /Rechazar cuenta empresa de Obras Patagónicas SA/);
});

test('crédito compacto distingue disponibilidad de cuenta y reserva la procedencia para el detalle', async t => {
  const component = load('components/AdminClientCreditStatus.vue', {}, true).default;
  const state = vue.reactive({ compact: true, credit: {
    state: 'READY', account: { estado: 'HABILITADA', estadoCredito: 'DISPONIBLE', origen: 'DEMO' },
  } });
  const dom = createTestRenderer();
  const rootEl = dom.createRoot();
  const app = dom.renderer.createApp({ render: () => vue.h(component, {
    company: true, compact: state.compact, credit: state.credit,
  }) });
  app.mount(rootEl);
  t.after(() => app.unmount());
  const html = () => dom.serialize(rootEl);
  assert.match(html(), /Cuenta habilitada/);
  assert.match(html(), /Crédito disponible<\/p>/);
  assert.doesNotMatch(html(), /según la cuenta|Datos de demostración/);
  state.compact = false;
  await settle();
  assert.match(html(), /Crédito disponible según la cuenta/);
  assert.match(html(), /Datos de demostración/);
  state.compact = true;
  for (const [status, label] of [['BLOQUEADO', 'Crédito bloqueado'], ['NO_DETERMINABLE', 'Crédito no determinable']]) {
    state.credit.account.estadoCredito = status;
    await settle();
    assert.match(html(), new RegExp(label));
    assert.doesNotMatch(html(), /Datos de demostración/);
  }
  state.credit = { state: 'ERROR' };
  await settle();
  assert.match(html(), /Crédito no disponible para consulta/);
  assert.match(html(), /Reintentar crédito/);
  assert.doesNotMatch(html(), /Sin cuenta corriente/);
});

function creditReader(t, read, ids = [1, 2, 3]) {
  const auth = vue.reactive({ rol: 'ADMIN', user: { id: 1 }, sessionVersion: 1, loggingIn: false, loggingOut: false });
  const clients = vue.ref(ids.map(id => ({ id, tipoCliente: 'EMPRESA', estadoAprobacionEmpresa: 'APROBADA' })));
  let dispose;
  const { useAdminClientCredit } = load('composables/useAdminClientCredit.ts', {
    vue: { ...vue, onBeforeUnmount: fn => { dispose = fn; } },
    '@/stores/auth': { useAuthStore: () => auth },
    '@/services/adminAccountService': { getAdminAccount: read },
  });
  const scope = vue.effectScope();
  const credit = scope.run(() => useAdminClientCredit(() => clients.value));
  t.after(() => { dispose(); scope.stop(); });
  return { credit, auth, clients };
}

test('S7-345-02: publica errores y éxitos sin esperar a otra empresa y reintenta solo la afectada', async t => {
  const calls = [];
  let rejectSecond;
  const { credit } = creditReader(t, (id, signal) => {
    calls.push({ id, signal });
    if (id === 1) return new Promise(() => {});
    if (id === 2 && calls.filter(call => call.id === 2).length === 1)
      return new Promise((_, reject) => { rejectSecond = reject; });
    return Promise.resolve({ estado: 'HABILITADA', estadoCredito: 'DISPONIBLE' });
  });
  assert.deepEqual(calls.map(call => call.id), [1, 2]);
  rejectSecond(Error('503'));
  await settle();
  assert.equal(credit.status(1), null);
  assert.equal(credit.status(2).state, 'ERROR');
  assert.equal(credit.status(3).state, 'READY');
  credit.refresh(2);
  credit.refresh(2);
  await settle();
  assert.equal(credit.status(2).state, 'READY');
  assert.deepEqual(calls.map(call => call.id), [1, 2, 3, 2]);
  assert.equal(calls[0].signal.aborted, false);
});

test('S7-345-02: vence la espera, permite reintentar y descarta una respuesta tardía', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveOld, oldSignal, attempts = 0;
  const { credit } = creditReader(t, (id, signal) => {
    if (id === 1 && ++attempts === 1) {
      oldSignal = signal;
      return new Promise(resolve => { resolveOld = resolve; });
    }
    return Promise.resolve({ estado: 'HABILITADA', estadoCredito: 'DISPONIBLE' });
  }, [1, 2]);
  await settle();
  const other = credit.status(2);
  t.mock.timers.tick(15_000);
  await settle();
  assert.equal(oldSignal.aborted, true);
  assert.equal(credit.status(1).state, 'ERROR');
  credit.refresh(1);
  await settle();
  resolveOld({ estado: 'INHABILITADA', estadoCredito: 'BLOQUEADO' });
  await settle();
  assert.equal(credit.status(1).account.estadoCredito, 'DISPONIBLE');
  assert.equal(credit.status(2), other);
});

test('S7-345-02: cambiar de sesión o salir cancela consultas y descarta resultados anteriores', async t => {
  const calls = [];
  const { credit, auth } = creditReader(t, (id, signal) => new Promise(resolve => {
    calls.push({ id, signal, resolve });
  }), [1, 2]);
  auth.sessionVersion++;
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(0, 2).every(call => call.signal.aborted));
  calls[0].resolve({ estadoCredito: 'BLOQUEADO' });
  calls[1].resolve({ estadoCredito: 'BLOQUEADO' });
  await settle();
  assert.equal(credit.status(1), null);
  calls[2].resolve({ estadoCredito: 'DISPONIBLE' });
  await settle();
  assert.equal(credit.status(1).account.estadoCredito, 'DISPONIBLE');
  auth.loggingOut = true;
  assert.equal(calls[3].signal.aborted, true);
  calls[3].resolve({ estadoCredito: 'DISPONIBLE' });
  await settle();
  assert.equal(credit.status(1), null);
  assert.equal(credit.status(2), null);
  assert.equal(calls.length, 4);
});

function findNode(n, pred) {
  if (pred(n)) return n;
  for (const c of n.children || []) {
    const found = findNode(c, pred);
    if (found) return found;
  }
  return null;
}

async function approvalView(t, service, auth) {
  const component = load('views/admin/AdminClientsView.vue', {
    ...(auth ? { '@/stores/auth': { useAuthStore: () => auth } } : {}),
    '@/services/adminClientService': {
      getAdminClients: (...args) => service.getAdminClients ? service.getAdminClients(...args) : Promise.resolve(sampleClients()),
      getAdminClientPage: (...args) => service.getAdminClientPage
        ? service.getAdminClientPage(...args)
        : Promise.resolve(clientPage()),
      getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
      updateAdminCompanyApproval: (...args) => service.updateAdminCompanyApproval(...args),
    },
    './AdminPriceListsPanel.vue': { __esModule: true, default: { render: () => null } },
  }).default;
  component.render = () => null;
  const dom = createTestRenderer();
  const app = dom.renderer.createApp(component);
  app.mount(dom.createRoot());
  t.after(() => app.unmount());
  await settle();
  return app._instance.setupState;
}

test('S7-345-03/06: PATCH vence y una lectura verificada permite recuperar sin aceptar la respuesta tardía', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, signal, mutations = 0;
  const service = {
    updateAdminCompanyApproval: (_id, _status, requestSignal) => {
      mutations++; signal = requestSignal;
      return new Promise(resolve => { release = resolve; });
    },
  };
  const state = await approvalView(t, service);
  const client = state.clients.find(c => c.id === 20);
  state.openClient(client, 'APROBADA');
  const request = state.confirmApproval();
  await settle();
  assert.equal(state.updatingApprovalClientIds[20], true);
  state.confirmApproval();
  assert.equal(mutations, 1);
  t.mock.timers.tick(15_000);
  await settle();
  assert.equal(state.updatingApprovalClientIds[20], undefined);
  assert.equal(state.uncertainApprovalClientIds[20], undefined);
  assert.equal(signal.aborted, true);
  state.closeClient();
  assert.equal(state.selectedClient, null);
  // El GET automático admite el estado anterior; no demuestra que el servidor canceló el PATCH.
  await state.reconcileCompanyApproval(20);
  assert.equal(state.uncertainApprovalClientIds[20], undefined);
  release({ ...sampleClients()[1], estadoAprobacionEmpresa: 'APROBADA' });
  await request;
  await settle();
  assert.equal(client.estadoAprobacionEmpresa, 'PENDIENTE');
  assert.equal(state.uncertainApprovalClientIds[20], undefined);
  // Una consulta posterior actualiza el estado, nunca la respuesta vencida.
  service.getAdminClients = async () => sampleClients().map(c => c.id === 20 ? { ...c, estadoAprobacionEmpresa: 'APROBADA' } : c);
  await state.reconcileCompanyApproval(20);
  assert.equal(client.estadoAprobacionEmpresa, 'APROBADA');
  assert.equal(state.uncertainApprovalClientIds[20], undefined);
  assert.equal(mutations, 1);
});

test('S7-345-03: verificación pendiente también vence y descarta su respuesta tardía', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = { updateAdminCompanyApproval: async () => { throw Error('respuesta perdida'); } };
  const state = await approvalView(t, service);
  let release, signal;
  service.getAdminClients = requestSignal => new Promise(resolve => { release = resolve; signal = requestSignal; });
  const request = state.setCompanyApproval(state.clients[1], 'APROBADA');
  await settle();
  assert.equal(state.reconcilingApprovalClientIds[20], true);
  t.mock.timers.tick(15_000);
  await request;
  assert.equal(signal.aborted, true);
  assert.equal(state.updatingApprovalClientIds[20], undefined);
  assert.equal(state.reconcilingApprovalClientIds[20], undefined);
  assert.equal(state.uncertainApprovalClientIds[20], true);
  release(sampleClients().map(c => ({ ...c, estadoAprobacionEmpresa: 'APROBADA' })));
  await settle();
  assert.equal(state.clients[1].estadoAprobacionEmpresa, 'PENDIENTE');
});

test('S7-345-03: salir de sesión cancela la modificación sin contaminar la siguiente sesión', async t => {
  const auth = vue.reactive({ rol: 'ADMIN', user: { id: 1 }, sessionVersion: 1, loggingIn: false, loggingOut: false });
  let release, signal;
  const state = await approvalView(t, {
    updateAdminCompanyApproval: (_id, _status, requestSignal) => new Promise(resolve => { release = resolve; signal = requestSignal; }),
  }, auth);
  const request = state.setCompanyApproval(state.clients[1], 'APROBADA');
  auth.sessionVersion++;
  await settle();
  assert.equal(signal.aborted, true);
  release({ ...sampleClients()[1], estadoAprobacionEmpresa: 'APROBADA' });
  await request;
  assert.equal(state.clients[1].estadoAprobacionEmpresa, 'PENDIENTE');
  assert.equal(state.updatingApprovalClientIds[20], undefined);
});

test('S7-345-04: cambiar aprobación refresca solo esa empresa y conserva resultados ajenos', async t => {
  const calls = [];
  let release;
  const { credit, clients } = creditReader(t, (id, signal) => {
    calls.push({ id, signal });
    if (calls.length > 3) return new Promise(resolve => { release = resolve; });
    return Promise.resolve({ estadoCredito: 'DISPONIBLE' });
  });
  await settle();
  const first = credit.status(1), last = credit.status(3);
  clients.value[1].estadoAprobacionEmpresa = 'RECHAZADA';
  await settle();
  assert.deepEqual(calls.map(c => c.id), [1, 2, 3, 2]);
  assert.equal(credit.status(1), first);
  assert.equal(credit.status(3), last);
  release({ estadoCredito: 'BLOQUEADO' });
  await settle();
  assert.equal(credit.status(2).account.estadoCredito, 'BLOQUEADO');
});

test('S7-345-04: aprobación durante una lectura pendiente descarta el crédito anterior y vuelve a consultar esa fila', async t => {
  const calls = [];
  let release;
  const { credit, clients } = creditReader(t, (id, signal) => {
    calls.push({ id, signal });
    if (id === 1 && calls.length === 1) return new Promise(resolve => { release = resolve; });
    return Promise.resolve({ estadoCredito: id === 1 ? 'BLOQUEADO' : 'DISPONIBLE' });
  }, [1, 2]);
  await settle();
  const other = credit.status(2);
  clients.value[0].estadoAprobacionEmpresa = 'RECHAZADA';
  await settle();
  assert.equal(calls[0].signal.aborted, false);
  release({ estadoCredito: 'DISPONIBLE' });
  await settle();
  assert.deepEqual(calls.map(c => c.id), [1, 2, 1]);
  assert.equal(credit.status(1).account.estadoCredito, 'BLOQUEADO');
  assert.equal(credit.status(2), other);
});

test('H-01: AdminClientsView renderiza botón Reintentar verificación y bloquea acciones ante resultado incierto', async t => {
  const service = {
    getAdminClientPage: async () => clientPage(),
    getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
    saveAdminClientPriceList: async () => null,
    updateAdminCompanyApproval: async () => {
      throw Object.assign(new Error('timeout'), { isAxiosError: true, response: undefined });
    },
  };
  const routeState = createRoute();

  const component = load(
    'views/admin/AdminClientsView.vue',
    clientViewMocks(service, routeState),
    true,
  ).default;

  const dom = createTestRenderer();
  const rootEl = dom.createRoot();
  const app = dom.renderer.createApp(component);
  app.mount(rootEl);
  t.after(() => app.unmount());
  await settle();

  // Reconciliación automática también falla simulando caída total de red/servidor
  service.getAdminClients = async () => {
    throw Object.assign(new Error('unreachable'), { isAxiosError: true, response: undefined });
  };

  const approveBtn = findNode(rootEl, n =>
    typeof n.props?.['aria-label'] === 'string' &&
    n.props['aria-label'].includes('Aprobar cuenta empresa de Constructora Sur SRL')
  );
  assert.ok(approveBtn, 'Botón de aprobar debe existir en el DOM');

  await approveBtn.props.onClick();
  await settle();
  const confirmation = findNode(rootEl, n => n.props?.['aria-label'] === 'Confirmar aprobación de prueba');
  assert.ok(confirmation, 'La aprobación requiere confirmar el diálogo');
  await confirmation.props.onClick();
  await settle();

  const html = dom.serialize(rootEl);
  assert.match(html, /Reintentar verificación/);
  assert.match(html, /El resultado es incierto/);

  // Verificar que el botón de aprobar quedó deshabilitado por el bloqueo de incertidumbre
  assert.equal(approveBtn.props.disabled, true);
});

test('setCompanyApproval actualiza APROBADA/RECHAZADA/PENDIENTE, bloquea doble envío con updatingApprovalClientId y maneja errores', async t => {
  const calls = [];
  let resolvePending;

  const service = {
    getAdminClientPage: async () => clientPage(),
    getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
    saveAdminClientPriceList: async () => null,
    updateAdminCompanyApproval: (id, status) => {
      calls.push([id, status]);
      if (resolvePending) {
        return new Promise(resolve => {
          const done = resolvePending;
          resolvePending = null;
          done(() =>
            resolve({
              ...sampleClients()[1],
              id,
              estadoAprobacionEmpresa: status,
            }),
          );
        });
      }
      return Promise.resolve({
        ...sampleClients()[1],
        id,
        estadoAprobacionEmpresa: status,
      });
    },
  };
  const routeState = createRoute();

  const component = load('views/admin/AdminClientsView.vue', clientViewMocks(service, routeState)).default;
  component.render = () => null;

  const dom = createTestRenderer();
  const app = dom.renderer.createApp(component);
  app.mount(dom.createRoot());
  t.after(() => app.unmount());
  await settle();

  const state = app._instance.setupState;
  const particular = state.clients[0];
  const empresaPendiente = state.clients[1];
  const empresaAprobada = state.clients[2];

  // No envía nada para PARTICULAR ni cuando el estado destino ya está activo
  await state.setCompanyApproval(particular, 'APROBADA');
  await state.setCompanyApproval(empresaAprobada, 'APROBADA');
  assert.equal(calls.length, 0);

  // Bloqueo de doble clic concurrente mediante updatingApprovalClientId
  let finishRequest;
  resolvePending = fn => {
    finishRequest = fn;
  };

  const inFlight = state.setCompanyApproval(empresaPendiente, 'APROBADA');
  assert.equal(state.updatingApprovalClientIds[20], true);

  // El doble envío de la misma fila se ignora; otra empresa sigue operable.
  await state.setCompanyApproval(empresaPendiente, 'RECHAZADA');
  await state.setCompanyApproval(empresaAprobada, 'RECHAZADA');
  assert.equal(calls.length, 2);
  assert.equal(empresaAprobada.estadoAprobacionEmpresa, 'RECHAZADA');
  assert.equal(state.updatingApprovalClientIds[20], true);

  finishRequest();
  await inFlight;
  assert.equal(state.updatingApprovalClientIds[20], undefined);
  assert.equal(empresaPendiente.estadoAprobacionEmpresa, 'APROBADA');
  assert.deepEqual(state.approvalFeedback[20], {
    text: 'Empresa aprobada.',
    error: false,
  });

  // Transición a RECHAZADA
  await state.setCompanyApproval(empresaPendiente, 'RECHAZADA');
  assert.equal(empresaPendiente.estadoAprobacionEmpresa, 'RECHAZADA');
  assert.deepEqual(state.approvalFeedback[20], {
    text: 'Empresa rechazada.',
    error: false,
  });

  // Transición a PENDIENTE
  await state.setCompanyApproval(empresaPendiente, 'PENDIENTE');
  assert.equal(empresaPendiente.estadoAprobacionEmpresa, 'PENDIENTE');

  // Manejo de error determinista 400 (no marca incierto ni reconcilia)
  service.updateAdminCompanyApproval = async () => {
    throw Object.assign(new Error('bad request'), {
      isAxiosError: true,
      response: { status: 400, data: { message: 'Solo las cuentas de tipo empresa admiten aprobación o rechazo.' } },
    });
  };
  await state.setCompanyApproval(empresaPendiente, 'APROBADA');
  assert.equal(state.updatingApprovalClientIds[20], undefined);
  assert.equal(state.uncertainApprovalClientIds[20], undefined);
  assert.equal(empresaPendiente.estadoAprobacionEmpresa, 'PENDIENTE');
  assert.deepEqual(state.approvalFeedback[20], {
    text: 'Solo las cuentas de tipo empresa admiten aprobación o rechazo.',
    error: true,
  });

  // H-01: Error 500 / red con reconciliación exitosa (MariaDB llegó a persistir APROBADA)
  service.updateAdminCompanyApproval = async () => {
    throw Object.assign(new Error('internal sql'), {
      isAxiosError: true,
      response: { status: 500, data: { message: 'detalle interno SQL' } },
    });
  };
  service.getAdminClients = async () => [
    sampleClients()[0],
    { ...sampleClients()[1], estadoAprobacionEmpresa: 'APROBADA' },
    sampleClients()[2],
    sampleClients()[3],
  ];

  await state.setCompanyApproval(empresaPendiente, 'APROBADA');
  assert.equal(state.updatingApprovalClientIds[20], undefined);
  assert.equal(state.uncertainApprovalClientIds[20], undefined);
  assert.equal(empresaPendiente.estadoAprobacionEmpresa, 'APROBADA');
  assert.deepEqual(state.approvalFeedback[20], {
    text: 'Estado verificado con el servidor.',
    error: false,
  });

  // H-01: Error 500 / corte de red con reconciliación fallida (bloqueo estricto e incertidumbre)
  service.updateAdminCompanyApproval = async () => {
    throw Object.assign(new Error('network error'), {
      isAxiosError: true,
      response: undefined,
    });
  };
  service.getAdminClients = async () => {
    throw Object.assign(new Error('server unreachable'), {
      isAxiosError: true,
      response: undefined,
    });
  };

  await state.setCompanyApproval(empresaPendiente, 'RECHAZADA');
  assert.equal(state.updatingApprovalClientIds[20], undefined);
  assert.equal(state.uncertainApprovalClientIds[20], true);
  assert.deepEqual(state.approvalFeedback[20], {
    text: 'No pudimos verificar el estado con el servidor. El resultado es incierto.',
    error: true,
  });

  // Intento de mutar mientras está en estado incierto debe ser ignorado estrictamente
  const callsBeforeBlindAttempt = calls.length;
  await state.setCompanyApproval(empresaPendiente, 'RECHAZADA');
  await state.setCompanyApproval(empresaPendiente, 'APROBADA');
  assert.equal(calls.length, callsBeforeBlindAttempt);

  // Reintento explícito de verificación reconcilia y desbloquea cuando el servidor vuelve a responder
  service.getAdminClients = async () => [
    sampleClients()[0],
    { ...sampleClients()[1], estadoAprobacionEmpresa: 'RECHAZADA' },
    sampleClients()[2],
    sampleClients()[3],
  ];
  await state.reconcileCompanyApproval(20);
  assert.equal(state.uncertainApprovalClientIds[20], undefined);
  assert.equal(empresaPendiente.estadoAprobacionEmpresa, 'RECHAZADA');
  assert.deepEqual(state.approvalFeedback[20], {
    text: 'Estado verificado con el servidor.',
    error: false,
  });
});

test('descarta el listado de una sesión ADMIN anterior', async t => {
  const auth = vue.reactive({ rol: 'ADMIN', user: { id: 1 }, sessionVersion: 1, loggingIn: false, loggingOut: false });
  let release;
  const component = load('views/admin/AdminClientsView.vue', {
    '@/stores/auth': { useAuthStore: () => auth },
    '@/services/adminClientService': {
      getAdminClientPage: () => new Promise(resolve => { release = resolve; }),
      getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
    },
    './AdminPriceListsPanel.vue': { __esModule: true, default: { render: () => null } },
  }).default;
  component.render = () => null;
  const dom = createTestRenderer();
  const app = dom.renderer.createApp(component);
  app.mount(dom.createRoot());
  t.after(() => app.unmount());
  const state = app._instance.setupState;
  auth.loggingOut = true;
  await settle();
  release(clientPage(sampleClients()));
  await settle();
  assert.deepEqual(state.clients, []);
  assert.equal(state.selectedClient, null);
});

test('no declara verificado un cliente ausente de la respuesta de reconciliación', async t => {
  let result = sampleClients();
  const component = load('views/admin/AdminClientsView.vue', {
    '@/services/adminClientService': {
      getAdminClients: async () => result,
      getAdminClientPage: async () => clientPage(result),
      getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
    },
    './AdminPriceListsPanel.vue': { __esModule: true, default: { render: () => null } },
  }).default;
  component.render = () => null;
  const dom = createTestRenderer();
  const app = dom.renderer.createApp(component);
  app.mount(dom.createRoot());
  t.after(() => app.unmount());
  await settle();
  const state = app._instance.setupState;
  result = [];
  await state.reconcileCompanyApproval(20);
  assert.equal(state.uncertainApprovalClientIds[20], true);
  assert.equal(state.approvalFeedback[20].error, true);
});

test('409 reconcilia el estado actual y no repite la modificación', async t => {
  let writes = 0, reads = 0;
  const service = {
    getAdminClientPage: async () => { reads++; return clientPage(sampleClients()); },
    getAdminClients: async () => { reads++; return sampleClients().map(c => c.id === 20 ? { ...c, estadoAprobacionEmpresa: 'RECHAZADA' } : c); },
    updateAdminCompanyApproval: async (id, target, signal, expected) => {
      writes++;
      assert.equal(expected, 'PENDIENTE');
      throw Object.assign(new Error('conflict'), { isAxiosError: true, response: { status: 409 } });
    },
  };
  const state = await approvalView(t, service);
  await state.setCompanyApproval(state.clients[1], 'APROBADA');
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(state.clients[1].estadoAprobacionEmpresa, 'RECHAZADA');
  assert.equal(state.uncertainApprovalClientIds[20], undefined);
});

test('una verificación pendiente no bloquea modificaciones de otra empresa', async t => {
  const service = { updateAdminCompanyApproval: async () => { throw Error('respuesta perdida'); } };
  const state = await approvalView(t, service);
  let finish;
  service.getAdminClients = () => new Promise(resolve => { finish = resolve; });
  const pending = state.setCompanyApproval(state.clients[1], 'APROBADA');
  await settle();
  assert.equal(state.reconcilingApprovalClientIds[20], true);
  service.updateAdminCompanyApproval = async (id, status) => ({ ...sampleClients()[2], id, estadoAprobacionEmpresa: status });
  state.openClient(state.clients[2], 'RECHAZADA');
  await state.confirmApproval();
  state.closeClient();
  assert.equal(state.selectedClient, null);
  assert.equal(state.clients[2].estadoAprobacionEmpresa, 'RECHAZADA');
  assert.equal(state.reconcilingApprovalClientIds[20], true);
  finish(sampleClients());
  await pending;
  assert.equal(state.clients[2].estadoAprobacionEmpresa, 'RECHAZADA', 'Reconciliar una fila no sustituye las demás');
});

function createDialogDom(t) {
  const prevHTMLElement = global.HTMLElement;
  const prevDocument = global.document;

  class FakeHTMLElement {
    constructor(tag, text = '') {
      this.tag = tag;
      this.text = text;
      this.props = {};
      this.children = [];
      this.parent = null;
      this.open = false;
      this.disabled = false;
      this.focusCalls = [];
    }
    get isConnected() {
      let current = this;
      while (current.parent) current = current.parent;
      return current.tag === 'root';
    }
    addEventListener() {}
    removeEventListener() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus(options) {
      if (this.disabled || this.props.disabled) return;
      this.focusCalls.push(options ?? null);
      fakeDocument.activeElement = vue.toRaw(this);
    }
    matches(selector) {
      if (selector === ':disabled') return Boolean(this.disabled || this.props.disabled);
      return false;
    }
    contains(target) {
      if (!target) return false;
      const rawTarget = vue.toRaw(target);
      if (vue.toRaw(this) === rawTarget) return true;
      return this.children.some(child => child.contains(rawTarget));
    }
    closest() { return null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getClientRects() { return []; }
  }

  const body = new FakeHTMLElement('body');
  const fakeDocument = { body, activeElement: body };
  global.HTMLElement = FakeHTMLElement;
  global.document = fakeDocument;
  t.after(() => {
    global.HTMLElement = prevHTMLElement;
    global.document = prevDocument;
  });

  const renderer = vue.createRenderer({
    createElement: tag => new FakeHTMLElement(tag),
    createText: text => new FakeHTMLElement('#text', text),
    createComment: text => new FakeHTMLElement('#comment', text),
    insert(el, parent, anchor) {
      el.parent = parent;
      const i = anchor ? parent.children.indexOf(anchor) : -1;
      if (i >= 0) parent.children.splice(i, 0, el);
      else parent.children.push(el);
    },
    remove(el) {
      if (!el.parent) return;
      const i = el.parent.children.indexOf(el);
      if (i >= 0) el.parent.children.splice(i, 1);
      el.parent = null;
      if (fakeDocument.activeElement && el.contains(fakeDocument.activeElement)) {
        fakeDocument.activeElement = fakeDocument.body;
      }
    },
    setText(el, text) { el.text = text; },
    setElementText(el, text) { el.text = text; el.children = []; },
    patchProp(el, key, _prev, next) {
      el.props[key] = next;
      if (key === 'disabled') el.disabled = Boolean(next);
    },
    parentNode: el => el.parent,
    nextSibling: el => {
      if (!el.parent) return null;
      const i = el.parent.children.indexOf(el);
      return el.parent.children[i + 1] || null;
    },
  });

  return { FakeHTMLElement, fakeDocument, renderer, createRoot: () => new FakeHTMLElement('root') };
}

test('S7-345-A01: retorna el foco al botón Ver detalle cuando el disparador queda disabled tras resultado incierto', async t => {
  const { FakeHTMLElement, fakeDocument, renderer, createRoot } = createDialogDom(t);
  const Dialog = load('components/AdminClientStatusDialog.vue', {}, true).default;

  const rootEl = createRoot();
  const row = new FakeHTMLElement('tr');
  const approveTrigger = new FakeHTMLElement('button');
  const detailFallback = new FakeHTMLElement('button');
  row.parent = rootEl;
  approveTrigger.parent = row;
  detailFallback.parent = row;
  approveTrigger.closest = sel => (sel === 'tr' ? row : null);
  row.querySelector = sel => (sel === '[data-client-detail]' ? detailFallback : null);

  fakeDocument.activeElement = approveTrigger;
  const open = vue.ref(true);
  const app = renderer.createApp({
    render: () => (open.value ? vue.h(Dialog, {
      client: sampleClients()[1],
      target: 'APROBADA',
      credit: null,
      busy: false,
      uncertain: true,
    }) : null),
  });
  app.mount(rootEl);
  t.after(() => app.unmount());
  await settle();

  approveTrigger.disabled = true;
  open.value = false;
  await settle();

  assert.equal(approveTrigger.focusCalls.length, 0);
  assert.equal(detailFallback.focusCalls.length, 1);
  assert.equal(fakeDocument.activeElement, detailFallback);
});

test('WCAG 2.4.3: enfoca el botón Cerrar dentro del diálogo cuando se confirma y se desmonta el botón de confirmación', async t => {
  const { fakeDocument, renderer, createRoot } = createDialogDom(t);
  const Dialog = load('components/AdminClientStatusDialog.vue', {}, true).default;

  const state = vue.reactive({
    client: { ...sampleClients()[1] },
    busy: false,
    uncertain: false,
  });
  const rootEl = createRoot();
  const app = renderer.createApp({
    render: () => vue.h(Dialog, {
      client: state.client,
      target: 'APROBADA',
      credit: null,
      busy: state.busy,
      uncertain: state.uncertain,
    }),
  });
  app.mount(rootEl);
  t.after(() => app.unmount());
  await settle();

  const confirmBtn = findNode(rootEl, n => n.tag === 'button' && n.text.includes('Confirmar aprobación'));
  const closeBtn = findNode(rootEl, n => n.tag === 'button' && n.props?.['aria-label'] === 'Cerrar detalle del cliente');
  assert.ok(confirmBtn);
  assert.ok(closeBtn);

  confirmBtn.focus();
  assert.equal(fakeDocument.activeElement, confirmBtn);

  state.busy = true;
  await settle();
  state.client.estadoAprobacionEmpresa = 'APROBADA';
  await settle();
  state.busy = false;
  await settle();

  assert.equal(findNode(rootEl, n => n.tag === 'button' && n.text.includes('Confirmar aprobación')), null);
  assert.equal(fakeDocument.activeElement, closeBtn);
  assert.deepEqual(closeBtn.focusCalls.at(-1), { preventScroll: true });
});
