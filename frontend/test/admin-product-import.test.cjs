const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const filename = path.resolve(__dirname, '../src/services/adminProductImport.ts');
const source = fs.readFileSync(filename, 'utf8');
let xlsxRows = [];
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const compiledModule = { exports: {} };
new Function('require', 'module', 'exports', code)(
  (name) =>
    name === 'read-excel-file/browser'
      ? { readSheet: async () => xlsxRows }
      : name === './adminProductService'
        ? {
            isCategoryActive: (category) =>
              category.activo === undefined ||
              category.activo === true ||
              category.activo === 1 ||
              category.activo === '1' ||
              category.activo === 'true',
          }
      : require(name),
  compiledModule,
  compiledModule.exports,
);
const {
  createProductImportErrorReport,
  createProductImportTemplate,
  parseProductImportCsv,
  parseProductImportXlsx,
  readProductImportRecovery,
  saveProductImportRecovery,
  getProductImportRecoveryKey,
  getProductImportTabId,
  PRODUCT_IMPORT_RECOVERY_KEY,
  PRODUCT_IMPORT_TAB_ID_KEY,
  PRODUCT_IMPORT_MAX_FILE_SIZE,
  PRODUCT_IMPORT_MAX_ROWS,
  PRODUCT_IMPORT_PREVIEW_ROWS,
  PRODUCT_IMPORT_REQUEST_TIMEOUT_MS,
} = compiledModule.exports;
const renderer = vue.createRenderer({
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
});

const categories = [{ id_categoria: 3, nombre: 'Herramientas', activo: 1 }];
const headers = 'codigo,nombre,id_categoria,precio,stock,descripcion,imagen,activo';
const recoveryTabId = '00000000-0000-4000-8000-000000000001';

test('parses quoted CSV fields, escaped quotes, line breaks, and zero stock', () => {
  const csv = [
    headers,
    'SKU-1,"Taladro, industrial",3,100.25,0,"Línea 1\r\nLínea ""2""",,true',
  ].join('\r\n');

  const [item] = parseProductImportCsv(csv, categories);
  assert.equal(item.line, 2);
  assert.equal(item.description, 'Línea 1\r\nLínea "2"');
  assert.equal(item.image, '');
  assert.equal(item.active, 'true');
  assert.deepEqual(item.errors, []);
  assert.deepEqual(item.payload, {
    codigo: 'SKU-1',
    nombre: 'Taladro, industrial',
    id_categoria: 3,
    precio: 100.25,
    stock: 0,
    descripcion: 'Línea 1\r\nLínea "2"',
    imagen: null,
    activo: true,
  });
});

test('supports semicolon-delimited files and decimal commas with physical line numbers', () => {
  const csv = [
    headers.replaceAll(',', ';'),
    '',
    'SKU-2;Taladro;3;100,50;4;Descripción; ;',
  ].join('\n');

  const [item] = parseProductImportCsv(csv, categories);
  assert.equal(item.line, 3);
  assert.equal(item.payload.precio, 100.5);
  assert.equal(item.payload.activo, true);
});

test('defers SKU uniqueness to the backend and reports invalid fields', () => {
  const csv = [
    headers,
    'EXISTENTE,Producto,3,10,1,,,true',
    'SKU-2,Producto,99,-1,1.5,,,no',
    'sku-2,Producto,3,10,1,,,true',
  ].join('\n');

  const items = parseProductImportCsv(csv, categories);
  assert.equal(items[0].status, 'ready');
  assert.equal(items[1].status, 'invalid');
  assert.ok(items[1].errors.some((error) => error.includes('no existe')));
  assert.ok(items[1].errors.some((error) => error.includes('precio')));
  assert.ok(items[1].errors.some((error) => error.includes('stock')));
  assert.ok(items[1].errors.some((error) => error.includes('true o false')));
  assert.equal(items[2].status, 'ready');
});

test('rejects malformed or incomplete CSV headers and unclosed quotes', () => {
  assert.throws(
    () => parseProductImportCsv('codigo,nombre\nSKU-1,Producto', categories),
    /Faltan columnas obligatorias/,
  );
  assert.throws(
    () =>
      parseProductImportCsv(
        `${headers}\nSKU-1,"Producto,3,10,1,,,true`,
        categories,
      ),
    /sin cerrar/,
  );
});

test('creates a template and neutralizes formulas and control characters in reports', () => {
  const [item] = parseProductImportCsv(
    `${headers}\nSKU-1,"Producto ""especial""",99,10,1,,,true`,
    categories,
  );
  const report = createProductImportErrorReport([
    item,
    {
      ...item,
      line: 3,
      codigo: '\u0000=1+1',
      nombre: '\t@SUM(1,1)',
      errors: ['Error\r\n=HYPERLINK("https://example.test")\u0000'],
    },
  ]);

  assert.equal(createProductImportTemplate(), `${headers}\r\n`);
  assert.ok(report.startsWith('\uFEFF"fila","codigo","nombre"'));
  assert.ok(report.includes('"Producto ""especial"""'));
  assert.ok(report.includes('"Error de validación"'));
  assert.ok(report.includes(`"' =1+1"`));
  assert.ok(report.includes(`"' @SUM(1,1)"`));
  assert.ok(report.includes('Error  =HYPERLINK('));
  assert.equal(/[\u0000-\u001F\u007F-\u009F]/.test(report.replaceAll('\r\n', '')), false);
});

test('parses XLSX rows through the same product contract', async () => {
  xlsxRows = [
    headers.split(','),
    ['SKU-XLSX', 'Taladro', 3, 10.5, 0, 'Descripción', 'https://example.test/img.png', false],
  ];

  const [item] = await parseProductImportXlsx({ size: 1024 }, categories);
  assert.equal(item.line, 2);
  assert.deepEqual(item.errors, []);
  assert.deepEqual(item.payload, {
    codigo: 'SKU-XLSX',
    nombre: 'Taladro',
    id_categoria: 3,
    precio: 10.5,
    stock: 0,
    descripcion: 'Descripción',
    imagen: 'https://example.test/img.png',
    activo: false,
  });
  await assert.rejects(
    parseProductImportXlsx(
      { size: PRODUCT_IMPORT_MAX_FILE_SIZE + 1 },
      categories,
    ),
    /5 MB/,
  );
});

test('reads a namespaced XLSX workbook with the actual browser parser', async () => {
  const browserModule = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name === 'read-excel-file/browser'
        ? require('read-excel-file/browser')
        : name === './adminProductService'
          ? {
              isCategoryActive: (category) =>
                category.activo === undefined ||
                category.activo === true ||
                category.activo === 1 ||
                category.activo === '1' ||
                category.activo === 'true',
            }
          : require(name),
    browserModule,
    browserModule.exports,
  );
  const fixture = fs.readFileSync(
    path.resolve(__dirname, 'fixtures/product-import-namespaced.xlsx'),
  );
  const file = new File([fixture], 'catalogo.xlsx');
  const [item] = await browserModule.exports.parseProductImportXlsx(file, categories);

  assert.equal(item.codigo, '000123');
  assert.equal(item.payload.precio, 10.5);
  assert.equal(item.payload.stock, 0);
  assert.equal(item.payload.activo, false);
  assert.deepEqual(item.errors, []);
});

test('limits parsed rows and recovers interrupted imports as uncertain', async () => {
  assert.throws(
    () => parseProductImportCsv('x'.repeat(PRODUCT_IMPORT_MAX_FILE_SIZE + 1), categories),
    /5 MB/,
  );
  const rows = Array.from(
    { length: PRODUCT_IMPORT_MAX_ROWS + 1 },
    (_, index) => `SKU-${index},Producto,3,10,1,,,true`,
  );
  assert.throws(
    () => parseProductImportCsv(`${headers}\n${rows.join('\n')}`, categories),
    /máximo de 1000 filas/,
  );

  const storage = {
    value: '',
    getItem() { return this.value || null; },
    setItem(_key, value) { this.value = value; },
  };
  const [item] = parseProductImportCsv(
    `${headers}\nSKU-1,Producto,3,10,1,,,true`,
    categories,
  );
  await saveProductImportRecovery(storage, {
    fileName: 'catalogo.csv',
    items: [{ ...item, status: 'creating' }],
  });
  assert.ok(await storage.getItem(PRODUCT_IMPORT_RECOVERY_KEY));
  const recovered = await readProductImportRecovery(storage);
  assert.equal(recovered.fileName, 'catalogo.csv');
  assert.equal(recovered.items[0].status, 'uncertain');
  assert.match(recovered.items[0].errors[0], /sesión se interrumpió/);
});

test('isolates recovery by administrator and browser tab', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const tabId = getProductImportTabId(storage);

  assert.match(tabId, /^[a-f0-9-]{36}$/i);
  assert.equal(getProductImportTabId(storage), tabId);
  assert.equal(values.get(PRODUCT_IMPORT_TAB_ID_KEY), tabId);
  assert.notEqual(
    getProductImportRecoveryKey(21, tabId),
    getProductImportRecoveryKey(21, '00000000-0000-4000-8000-000000000001'),
  );
  assert.notEqual(
    getProductImportRecoveryKey(21, tabId),
    getProductImportRecoveryKey(22, tabId),
  );
});

async function mountImportView(t, service, options = {}) {
  const viewPath = path.resolve(
    __dirname,
    '../src/views/admin/AdminProductImportView.vue',
  );
  const descriptor = parse(fs.readFileSync(viewPath, 'utf8'), {
    filename: viewPath,
  }).descriptor;
  const script = compileScript(descriptor, { id: 'admin-import-test' }).content;
  const compiled = ts.transpileModule(script, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const viewModule = { exports: {} };
  const previousWindow = global.window;
  const values = new Map();
  values.set(PRODUCT_IMPORT_TAB_ID_KEY, recoveryTabId);
  const storage = options.storage ?? {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
  };
  const auth = options.auth ?? vue.reactive({
    user: { id: 21, rol: 'ADMIN' },
    rol: 'ADMIN',
    sessionVersion: 1,
    async fetchSession() {},
  });
  global.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name === '@/services/adminProductService') return service;
      if (name === '@/stores/auth') return { useAuthStore: () => auth };
      if (name === '@/services/adminProductImport') {
        return {
          ...compiledModule.exports,
          createProductImportRecoveryStorage: () => storage,
        };
      }
      return require(name);
    },
    viewModule,
    viewModule.exports,
  );
  const component = viewModule.exports.default;
  component.render = () => null;
  const app = renderer.createApp(component);
  app.mount({});
  t.after(() => {
    app.unmount();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  });
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await vue.nextTick();
  }
  return {
    state: app._instance.setupState,
    app,
    storage,
    auth,
  };
}

test('previews valid rows, imports sequentially, and retries only rejected rows', async (t) => {
  const calls = [];
  let referenceLoads = 0;
  let sku2Attempts = 0;
  const service = {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => {
      referenceLoads += 1;
      return [];
    },
    saveAdminProduct: async (payload, _productId, requestConfig) => {
      calls.push(payload.codigo);
      assert.equal(requestConfig.timeout, PRODUCT_IMPORT_REQUEST_TIMEOUT_MS);
      assert.ok(requestConfig.signal instanceof AbortSignal);
      if (payload.codigo === 'SKU-2' && sku2Attempts++ === 0) {
        throw Object.assign(new Error('SKU duplicado'), {
          isAxiosError: true,
          response: { status: 409, data: { message: 'SKU duplicado' } },
        });

      }
    },
  };
  const { state } = await mountImportView(t, service);
  const csv = [
    headers,
    'SKU-1,Producto 1,3,10,1,,,true',
    'SKU-2,Producto 2,3,20,2,,,true',
  ].join('\n');

  await state.selectFile({ name: 'catalogo.csv', text: async () => csv });
  assert.equal(referenceLoads, 2);
  assert.equal(state.readyItems.length, 2);
  await state.importProducts();
  assert.equal(referenceLoads, 3);
  assert.deepEqual(calls, ['SKU-1', 'SKU-2']);
  assert.deepEqual(
    state.items.map((item) => item.status),
    ['created', 'rejected'],
  );

  await state.importProducts(true);
  assert.equal(referenceLoads, 4);
  assert.deepEqual(calls, ['SKU-1', 'SKU-2', 'SKU-2']);
  assert.deepEqual(
    state.items.map((item) => item.status),
    ['created', 'created'],
  );
});

test('marks exact duplicate SKUs invalid before any product can be confirmed', () => {
  const items = parseProductImportCsv(
    `${headers}\nSKU-DUP,Producto 1,3,10,1,,,true\nSKU-DUP,Producto 2,3,20,2,,,true`,
    categories,
  );
  assert.deepEqual(items.map((item) => item.status), ['invalid', 'invalid']);
  assert.ok(items.every((item) => item.payload === null));
  assert.ok(items.every((item) => item.errors.some((error) => error.includes('repetido'))));
});

test('does not treat a string zero category status as active', () => {
  const [item] = parseProductImportCsv(
    `${headers}\nSKU-1,Producto,3,10,1,,,true`,
    [{ id_categoria: 3, nombre: 'Inactiva', activo: '0' }],
  );
  assert.equal(item.status, 'invalid');
  assert.ok(item.errors.some((error) => error.includes('no existe o no está activa')));
});

test('parses XLSX files and renders only the bounded preview', async (t) => {
  xlsxRows = [
    headers.split(','),
    ...Array.from({ length: PRODUCT_IMPORT_PREVIEW_ROWS + 1 }, (_, index) => [
      `SKU-${index}`,
      'Producto',
      3,
      10,
      1,
      '',
      '',
      true,
    ]),
  ];
  const service = {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async () => {},
  };
  const { state } = await mountImportView(t, service);

  await state.selectFile({ name: 'catalogo.xlsx', size: 1024 });
  assert.equal(state.items.length, PRODUCT_IMPORT_PREVIEW_ROWS + 1);
  assert.equal(state.visibleItems.length, PRODUCT_IMPORT_PREVIEW_ROWS);
  assert.equal(state.previewPageCount, 2);
  assert.equal(state.items[0].payload.activo, true);
  state.previewPage += 1;
  assert.equal(state.visibleItems.length, 1);
  assert.equal(state.visibleItems[0].description, '');
});

test('previews description, image URL, and active state before confirmation', () => {
  const viewPath = path.resolve(
    __dirname,
    '../src/views/admin/AdminProductImportView.vue',
  );
  const viewSource = fs.readFileSync(viewPath, 'utf8');

  assert.ok(viewSource.includes('>Descripción</th>'));
  assert.ok(viewSource.includes('>Imagen (URL)</th>'));
  assert.ok(viewSource.includes('>Estado activo</th>'));
  assert.ok(viewSource.includes('{{ item.description || \'—\' }}'));
  assert.ok(viewSource.includes('{{ item.image || \'—\' }}'));
  assert.ok(viewSource.includes("item.payload.activo ? 'Activo' : 'Inactivo'"));
});

test('marks timed-out requests uncertain and never retries them automatically', async (t) => {
  const calls = [];
  const service = {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async (payload, _productId, requestConfig) => {
      calls.push(payload.codigo);
      assert.equal(requestConfig.timeout, PRODUCT_IMPORT_REQUEST_TIMEOUT_MS);
      throw Object.assign(new Error('request timeout'), {
        isAxiosError: true,
        code: 'ECONNABORTED',
      });
    },
  };
  const { state, storage } = await mountImportView(t, service);
  const csv = [
    headers,
    'SKU-1,Producto 1,3,10,1,,,true',
    'SKU-2,Producto 2,3,20,2,,,true',
  ].join('\n');

  await state.selectFile({ name: 'catalogo.csv', text: async () => csv });
  await state.importProducts();
  await state.importProducts(true);

  assert.deepEqual(calls, ['SKU-1']);
  assert.deepEqual(
    state.items.map((item) => item.status),
    ['uncertain', 'ready'],
  );
  assert.deepEqual(
    (await readProductImportRecovery(storage, getProductImportRecoveryKey(21, recoveryTabId))).items.map((item) => item.status),
    ['uncertain', 'ready'],
  );
});

test('aborts an in-flight create and recovers its result when leaving the screen', async (t) => {
  const calls = [];
  let requestSignal;
  const service = {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async (payload, _productId, requestConfig) => {
      calls.push(payload.codigo);
      requestSignal = requestConfig.signal;
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => {
          reject(Object.assign(new Error('request aborted'), { name: 'CanceledError' }));
        });
      });
    },
  };
  const { state, app, storage } = await mountImportView(t, service);
  const csv = [
    headers,
    'SKU-1,Producto 1,3,10,1,,,true',
    'SKU-2,Producto 2,3,20,2,,,true',
  ].join('\n');

  await state.selectFile({ name: 'catalogo.csv', text: async () => csv });
  const importPromise = state.importProducts();
  await new Promise((resolve) => setImmediate(resolve));
  app.unmount();
  await importPromise;

  const recovered = await readProductImportRecovery(storage, getProductImportRecoveryKey(21, recoveryTabId));
  assert.deepEqual(calls, ['SKU-1']);
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(
    recovered.items.map((item) => item.status),
    ['uncertain', 'ready'],
  );
});

test('stores recovery separately for each authenticated admin', async (t) => {
  const storage = {
    values: new Map(),
    async getItem(key) { return this.values.get(key) ?? null; },
    async setItem(key, value) { this.values.set(key, value); },
  };
  const [item] = parseProductImportCsv(
    `${headers}\nSKU-PRIVATE,Producto privado,3,10,1,,,true`,
    categories,
  );
  await saveProductImportRecovery(
    storage,
    { fileName: 'privado.csv', items: [item] },
    getProductImportRecoveryKey(22, recoveryTabId),
  );
  const { state } = await mountImportView(t, {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async () => {},
  }, { storage });

  assert.notEqual(
    getProductImportRecoveryKey(21, recoveryTabId),
    getProductImportRecoveryKey(22, recoveryTabId),
  );
  assert.equal(state.items.length, 0);
  assert.equal(state.isRecovered, false);
});

test('blocks product requests when durable recovery storage fails', async (t) => {
  let createCalls = 0;
  const storage = {
    async getItem() { return null; },
    async setItem() { throw new Error('QuotaExceededError'); },
  };
  const { state } = await mountImportView(t, {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async () => { createCalls += 1; },
  }, { storage });
  await state.selectFile({
    name: 'catalogo.csv',
    text: async () => `${headers}\nSKU-1,Producto,3,10,1,,,true`,
  });

  await state.importProducts();
  assert.equal(state.recoveryError, 'QuotaExceededError');
  assert.equal(createCalls, 0);
});

test('a concurrent confirmation call cannot duplicate an in-flight batch', async (t) => {
  const calls = [];
  let releaseCreate;
  const service = {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async (payload) => {
      calls.push(payload.codigo);
      await new Promise((resolve) => { releaseCreate = resolve; });
    },
  };
  const { state } = await mountImportView(t, service);
  await state.selectFile({
    name: 'catalogo.csv',
    text: async () => `${headers}\nSKU-1,Producto 1,3,10,1,,,true`,
  });

  const firstImport = state.importProducts();
  const secondImport = state.importProducts();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['SKU-1']);
  releaseCreate();
  await Promise.all([firstImport, secondImport]);
  assert.deepEqual(state.items.map((item) => item.status), ['created']);
});

test('stops the batch and marks its in-flight row uncertain when the session changes', async (t) => {
  const calls = [];
  let requestSignal;
  const service = {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async (payload, _productId, requestConfig) => {
      calls.push(payload.codigo);
      requestSignal = requestConfig.signal;
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => {
          reject(Object.assign(new Error('request aborted'), { name: 'CanceledError' }));
        });
      });
    },
  };
  const { state, auth, storage } = await mountImportView(t, service);
  await state.selectFile({
    name: 'catalogo.csv',
    text: async () => [
      headers,
      'SKU-1,Producto 1,3,10,1,,,true',
      'SKU-2,Producto 2,3,20,2,,,true',
    ].join('\n'),
  });

  const importPromise = state.importProducts();
  await new Promise((resolve) => setImmediate(resolve));
  auth.sessionVersion += 1;
  await vue.nextTick();
  await importPromise;

  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(calls, ['SKU-1']);
  assert.deepEqual(state.items.map((item) => item.status), ['uncertain', 'ready']);
  assert.deepEqual(
    (await readProductImportRecovery(storage, getProductImportRecoveryKey(21, recoveryTabId))).items.map((item) => item.status),
    ['uncertain', 'ready'],
  );
});

test('refuses to submit a preview when the authenticated account changed in another tab', async (t) => {
  let sessionChecks = 0;
  const auth = vue.reactive({
    user: { id: 21, rol: 'ADMIN' },
    rol: 'ADMIN',
    sessionVersion: 1,
    async fetchSession() {
      sessionChecks += 1;
      if (sessionChecks === 2) {
        this.user = { id: 22, rol: 'ADMIN' };
        this.sessionVersion += 1;
      }
    },
  });
  let createCalls = 0;
  const { state } = await mountImportView(t, {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async () => { createCalls += 1; },
  }, { auth });
  await state.selectFile({
    name: 'catalogo.csv',
    text: async () => `${headers}\nSKU-1,Producto,3,10,1,,,true`,
  });

  await state.importProducts();
  assert.equal(createCalls, 0);
  assert.equal(state.items.length, 0);
  assert.match(state.recoveryError, /sesión administrativa cambió/);
});
