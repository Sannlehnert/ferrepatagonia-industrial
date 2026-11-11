const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const ts = require('typescript');

const root = path.resolve(__dirname, '../src');

function createTestRenderer() {
  const node = (tag, text = '') => ({ tag, text, props: {}, children: [], parent: null });
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
});

test('AdminClientsView renderiza tipos, badges PENDIENTE/APROBADA/RECHAZADA y acciones Aprobar/Rechazar', async t => {
  const service = {
    getAdminClients: async () => sampleClients(),
    getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
    saveAdminClientPriceList: async () => null,
    updateAdminCompanyApproval: async () => sampleClients()[1],
  };

  const component = load(
    'views/admin/AdminClientsView.vue',
    {
      '@/services/adminClientService': service,
      './AdminPriceListsPanel.vue': { __esModule: true, default: { render: () => null } },
    },
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
});

function findNode(n, pred) {
  if (pred(n)) return n;
  for (const c of n.children || []) {
    const found = findNode(c, pred);
    if (found) return found;
  }
  return null;
}

test('H-01: AdminClientsView renderiza botón Reintentar verificación y bloquea acciones ante resultado incierto', async t => {
  const service = {
    getAdminClients: async () => sampleClients(),
    getAdminClientPriceLists: async () => ({ listas: [], asignaciones: [] }),
    saveAdminClientPriceList: async () => null,
    updateAdminCompanyApproval: async () => {
      throw Object.assign(new Error('timeout'), { isAxiosError: true, response: undefined });
    },
  };

  const component = load(
    'views/admin/AdminClientsView.vue',
    {
      '@/services/adminClientService': service,
      './AdminPriceListsPanel.vue': { __esModule: true, default: { render: () => null } },
    },
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
    getAdminClients: async () => sampleClients(),
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

  const component = load('views/admin/AdminClientsView.vue', {
    '@/services/adminClientService': service,
    './AdminPriceListsPanel.vue': { default: { render: () => null } },
  }).default;
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
  assert.equal(state.updatingApprovalClientId, 20);

  // Intentos concurrentes mientras updatingApprovalClientId !== null son ignorados
  await state.setCompanyApproval(empresaPendiente, 'RECHAZADA');
  await state.setCompanyApproval(empresaAprobada, 'RECHAZADA');
  assert.equal(calls.length, 1);

  finishRequest();
  await inFlight;
  assert.equal(state.updatingApprovalClientId, null);
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
  assert.equal(state.updatingApprovalClientId, null);
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
  assert.equal(state.updatingApprovalClientId, null);
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
  assert.equal(state.updatingApprovalClientId, null);
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
