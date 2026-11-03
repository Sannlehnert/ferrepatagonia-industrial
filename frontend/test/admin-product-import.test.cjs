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
  PRODUCT_IMPORT_RECOVERY_KEY,
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

test('limits parsed rows and recovers interrupted imports as uncertain', () => {
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
  saveProductImportRecovery(storage, {
    fileName: 'catalogo.csv',
    items: [{ ...item, status: 'creating' }],
  });
  assert.ok(storage.getItem(PRODUCT_IMPORT_RECOVERY_KEY));
  const recovered = readProductImportRecovery(storage);
  assert.equal(recovered.fileName, 'catalogo.csv');
  assert.equal(recovered.items[0].status, 'uncertain');
  assert.match(recovered.items[0].errors[0], /sesión se interrumpió/);
});

async function mountImportView(t, service) {
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
  global.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name === '@/services/adminProductService') return service;
      if (name === '@/services/adminProductImport') {
        return compiledModule.exports;
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
    storage: global.window.sessionStorage,
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
    readProductImportRecovery(storage).items.map((item) => item.status),
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

  const recovered = readProductImportRecovery(storage);
  assert.deepEqual(calls, ['SKU-1']);
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(
    recovered.items.map((item) => item.status),
    ['uncertain', 'ready'],
  );
});
