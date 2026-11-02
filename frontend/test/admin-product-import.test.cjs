const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const filename = path.resolve(__dirname, '../src/services/adminProductImport.ts');
const source = fs.readFileSync(filename, 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const compiledModule = { exports: {} };
new Function('require', 'module', 'exports', code)(
  require,
  compiledModule,
  compiledModule.exports,
);
const {
  createProductImportErrorReport,
  createProductImportTemplate,
  parseProductImportCsv,
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
const product = {
  id_producto: 9,
  id_categoria: 3,
  codigo: 'EXISTENTE',
  nombre: 'Existente',
  descripcion: null,
  precio: 12,
  stock: 1,
  imagen: null,
  activo: 1,
};
const headers = 'codigo,nombre,id_categoria,precio,stock,descripcion,imagen,activo';

test('parses quoted CSV fields, escaped quotes, line breaks, and zero stock', () => {
  const csv = [
    headers,
    'SKU-1,"Taladro, industrial",3,100.25,0,"Línea 1\r\nLínea ""2""",,true',
  ].join('\r\n');

  const [item] = parseProductImportCsv(csv, categories, []);
  assert.equal(item.line, 2);
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

  const [item] = parseProductImportCsv(csv, categories, []);
  assert.equal(item.line, 3);
  assert.equal(item.payload.precio, 100.5);
  assert.equal(item.payload.activo, true);
});

test('reports existing and repeated SKUs, unavailable categories, and invalid fields', () => {
  const csv = [
    headers,
    'EXISTENTE,Producto,3,10,1,,,true',
    'SKU-2,Producto,99,-1,1.5,,,no',
    'SKU-2,Producto,3,10,1,,,true',
  ].join('\n');

  const items = parseProductImportCsv(csv, categories, [product]);
  assert.equal(items[0].status, 'invalid');
  assert.ok(items[0].errors.some((error) => error.includes('ya existe')));
  assert.equal(items[1].status, 'invalid');
  assert.ok(items[1].errors.some((error) => error.includes('no existe')));
  assert.ok(items[1].errors.some((error) => error.includes('precio')));
  assert.ok(items[1].errors.some((error) => error.includes('stock')));
  assert.ok(items[1].errors.some((error) => error.includes('true o false')));
  assert.ok(items[2].errors.some((error) => error.includes('repetido')));
});

test('rejects malformed or incomplete CSV headers and unclosed quotes', () => {
  assert.throws(
    () => parseProductImportCsv('codigo,nombre\nSKU-1,Producto', categories, []),
    /Faltan columnas obligatorias/,
  );
  assert.throws(
    () =>
      parseProductImportCsv(
        `${headers}\nSKU-1,"Producto,3,10,1,,,true`,
        categories,
        [],
      ),
    /sin cerrar/,
  );
});

test('creates a template and an Excel-friendly escaped error report', () => {
  const [item] = parseProductImportCsv(
    `${headers}\nSKU-1,"Producto ""especial""",99,10,1,,,true`,
    categories,
    [],
  );
  const report = createProductImportErrorReport([
    item,
    { ...item, line: 3, codigo: '=1+1', nombre: '@SUM(1,1)' },
  ]);

  assert.equal(createProductImportTemplate(), `${headers}\r\n`);
  assert.ok(report.startsWith('\uFEFF"fila","codigo","nombre"'));
  assert.ok(report.includes('"Producto ""especial"""'));
  assert.ok(report.includes('"Error de validación"'));
  assert.ok(report.includes(`"'=1+1"`));
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
  t.after(() => app.unmount());
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await vue.nextTick();
  }
  return app._instance.setupState;
}

test('previews valid rows, imports sequentially, and retries only rejected rows', async (t) => {
  const calls = [];
  let sku2Attempts = 0;
  const service = {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async (payload) => {
      calls.push(payload.codigo);
      if (payload.codigo === 'SKU-2' && sku2Attempts++ === 0) {
        throw Object.assign(new Error('SKU duplicado'), {
          isAxiosError: true,
          response: { status: 409, data: { message: 'SKU duplicado' } },
        });
      }
    },
  };
  const state = await mountImportView(t, service);
  const csv = [
    headers,
    'SKU-1,Producto 1,3,10,1,,,true',
    'SKU-2,Producto 2,3,20,2,,,true',
  ].join('\n');

  await state.selectFile({ name: 'catalogo.csv', text: async () => csv });
  assert.equal(state.readyItems.length, 2);
  await state.importProducts();
  assert.deepEqual(calls, ['SKU-1', 'SKU-2']);
  assert.deepEqual(
    state.items.map((item) => item.status),
    ['created', 'rejected'],
  );

  await state.importProducts(true);
  assert.deepEqual(calls, ['SKU-1', 'SKU-2', 'SKU-2']);
  assert.deepEqual(
    state.items.map((item) => item.status),
    ['created', 'created'],
  );
});

test('stops after an ambiguous response and never retries the uncertain row', async (t) => {
  const calls = [];
  const service = {
    getActiveCategories: async () => categories,
    getAdminProducts: async () => [],
    saveAdminProduct: async (payload) => {
      calls.push(payload.codigo);
      throw new Error('network unavailable');
    },
  };
  const state = await mountImportView(t, service);
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
});
