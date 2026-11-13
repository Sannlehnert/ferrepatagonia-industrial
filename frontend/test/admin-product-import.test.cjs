const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { strToU8, zipSync } = require('fflate');

const filename = path.resolve(__dirname, '../src/services/adminProductImport.ts');
const source = fs.readFileSync(filename, 'utf8');
let xlsxRows = [];
let readSheetCalls = 0;
let unzipSyncCalls = 0;
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
    ? {
        readSheet: async () => {
          readSheetCalls += 1;
          return xlsxRows;
        },
      }
      : name === './adminProductService'
        ? {
            isCategoryActive: (category) =>
              category.activo === undefined ||
              category.activo === true ||
              category.activo === 1 ||
              category.activo === '1' ||
              category.activo === 'true',
          }
      : name === 'fflate'
        ? {
            ...require(name),
            unzipSync: (...args) => {
              unzipSyncCalls += 1;
              return require(name).unzipSync(...args);
            },
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
  PRODUCT_IMPORT_MAX_UNCOMPRESSED_SIZE,
  PRODUCT_IMPORT_MAX_ROWS,
} = compiledModule.exports;

const categories = [{ id_categoria: 3, nombre: 'Herramientas', activo: 1 }];
const headers = 'codigo,nombre,id_categoria,precio,stock,descripcion,imagen,activo';
const recoveryTabId = '00000000-0000-4000-8000-000000000001';

function makeXlsxFile(sheetXml = '<worksheet/>') {
  const contents = zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Productos" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  });
  const buffer = contents.buffer.slice(
    contents.byteOffset,
    contents.byteOffset + contents.byteLength,
  );
  return {
    size: contents.byteLength,
    arrayBuffer: async () => buffer,
  };
}

function makeAmbiguousXlsxFile() {
  const contents = zipSync({
    'xl/worksheets/sheet1.xml': strToU8(
      'x'.repeat(PRODUCT_IMPORT_MAX_UNCOMPRESSED_SIZE + 1),
    ),
  });
  const view = new DataView(contents.buffer, contents.byteOffset, contents.byteLength);
  let endRecordOffset = contents.length - 22;
  while (view.getUint32(endRecordOffset, true) !== 0x06054b50) {
    endRecordOffset -= 1;
  }
  const directoryOffset = view.getUint32(endRecordOffset + 16, true);
  const directorySize = view.getUint32(endRecordOffset + 12, true);
  const localFile = contents.slice(0, directoryOffset);
  const hiddenDirectory = contents.slice(directoryOffset, directoryOffset + directorySize);
  const visibleDirectory = hiddenDirectory.slice();
  new DataView(
    visibleDirectory.buffer,
    visibleDirectory.byteOffset,
    visibleDirectory.byteLength,
  ).setUint32(24, 1, true);

  const visibleDirectoryOffset = localFile.length;
  const hiddenDirectoryOffset = visibleDirectoryOffset + visibleDirectory.length;
  const visibleEndRecord = Buffer.alloc(22);
  visibleEndRecord.writeUInt32LE(0x06054b50, 0);
  visibleEndRecord.writeUInt16LE(1, 8);
  visibleEndRecord.writeUInt16LE(1, 10);
  visibleEndRecord.writeUInt32LE(visibleDirectory.length, 12);
  visibleEndRecord.writeUInt32LE(visibleDirectoryOffset, 16);
  visibleEndRecord.writeUInt16LE(26, 20);

  const hiddenEndRecord = Buffer.alloc(22);
  hiddenEndRecord.writeUInt32LE(0x06054b50, 0);
  hiddenEndRecord.writeUInt16LE(1, 8);
  hiddenEndRecord.writeUInt16LE(1, 10);
  hiddenEndRecord.writeUInt32LE(hiddenDirectory.length, 12);
  hiddenEndRecord.writeUInt32LE(hiddenDirectoryOffset, 16);
  const archive = Buffer.concat([
    localFile,
    visibleDirectory,
    hiddenDirectory,
    visibleEndRecord,
    hiddenEndRecord,
    Buffer.from('tail'),
  ]);
  return {
    size: archive.byteLength,
    arrayBuffer: async () =>
      archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength,
      ),
  };
}

function makeSharedStoredBlockXlsxFile(declaredSize) {
  const contents = zipSync({
    'item-00.bin': [
      strToU8('x'.repeat(2 * 1024 * 1024)),
      { level: 0 },
    ],
  });
  const view = new DataView(contents.buffer, contents.byteOffset, contents.byteLength);
  let endRecordOffset = contents.length - 22;
  while (view.getUint32(endRecordOffset, true) !== 0x06054b50) {
    endRecordOffset -= 1;
  }

  const directoryOffset = view.getUint32(endRecordOffset + 16, true);
  const directorySize = view.getUint32(endRecordOffset + 12, true);
  const entry = contents.slice(directoryOffset, directoryOffset + directorySize);
  const filenameLength = view.getUint16(directoryOffset + 28, true);
  assert.equal(filenameLength, Buffer.byteLength('item-00.bin'));
  const entryLength = 46 + filenameLength;
  assert.equal(directorySize, entryLength);

  const entries = Buffer.alloc(entryLength * 13);
  for (let index = 0; index < 13; index += 1) {
    const offset = index * entryLength;
    entries.set(entry, offset);
    entries.write(`item-${String(index).padStart(2, '0')}.bin`, offset + 46);
    entries.writeUInt32LE(declaredSize, offset + 24);
  }

  const localFile = contents.slice(0, directoryOffset);
  const endRecord = Buffer.from(contents.slice(directoryOffset + directorySize));
  endRecord.writeUInt16LE(13, 8);
  endRecord.writeUInt16LE(13, 10);
  endRecord.writeUInt32LE(entries.length, 12);
  endRecord.writeUInt32LE(localFile.length, 16);
  const archive = Buffer.concat([localFile, entries, endRecord]);

  return {
    size: archive.byteLength,
    arrayBuffer: async () =>
      archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength,
      ),
  };
}

async function makeZip64AlternateDirectoryFile() {
  const shared = makeSharedStoredBlockXlsxFile(2 * 1024 * 1024);
  const bytes = Buffer.from(await shared.arrayBuffer());
  const end = bytes.length - 22;
  const offset = bytes.readUInt32LE(end + 16);
  const directory = bytes.subarray(offset, end);
  const visible = Buffer.from(directory.subarray(0, 46 + directory.readUInt16LE(28)));
  visible.writeUInt32LE(1, 20);
  visible.writeUInt32LE(1, 24);
  const zip64 = Buffer.alloc(56);
  zip64.writeUInt32LE(0x06064b50, 0);
  zip64.writeBigUInt64LE(44n, 4);
  zip64.writeUInt16LE(45, 12);
  zip64.writeUInt16LE(45, 14);
  zip64.writeBigUInt64LE(13n, 24);
  zip64.writeBigUInt64LE(13n, 32);
  zip64.writeBigUInt64LE(BigInt(directory.length), 40);
  zip64.writeBigUInt64LE(BigInt(offset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
  locator.writeUInt32LE(1, 16);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(visible.length, 12);
  eocd.writeUInt32LE(offset + directory.length + zip64.length, 16);
  return new File([
    bytes.subarray(0, offset), directory, zip64, visible, locator, eocd,
  ], 'zip64.xlsx');
}

test('rejects ZIP64 redirection before extraction', async () => {
  const callsBefore = unzipSyncCalls;
  const readerBefore = readSheetCalls;
  const file = await makeZip64AlternateDirectoryFile();

  await assert.rejects(parseProductImportXlsx(file, categories), /ZIP64/);
  assert.equal(unzipSyncCalls, callsBefore);
  assert.equal(readSheetCalls, readerBefore);
});

test('rejects EOCD ZIP64 sentinel fields before extraction', async () => {
  for (const [offset, width] of [[8, 2], [10, 2], [12, 4], [16, 4]]) {
    const bytes = Buffer.from(await makeXlsxFile().arrayBuffer());
    const end = bytes.length - 22;
    if (width === 2) bytes.writeUInt16LE(0xffff, end + offset);
    else bytes.writeUInt32LE(0xffffffff, end + offset);
    const callsBefore = unzipSyncCalls;
    await assert.rejects(parseProductImportXlsx(new File([bytes], 'sentinel.xlsx'), categories), /ZIP no compatible/);
    assert.equal(unzipSyncCalls, callsBefore);
  }
});

test('allows conventional STORE and DEFLATE with incidental ZIP64 signatures in file data', async () => {
  for (const level of [0, 6]) {
    const bytes = zipSync({ 'notes.bin': strToU8('PK\u0006\u0007 ZIP64 PK\u0006\u0006') }, { level });
    xlsxRows = [headers.split(','), ['000123', 'Producto', 3, 10, 1, '', '', true]];
    const callsBefore = unzipSyncCalls;
    const [item] = await parseProductImportXlsx(new File([bytes], 'ordinary.xlsx'), categories);
    assert.equal(unzipSyncCalls, callsBefore + 1);
    assert.equal(item.codigo, '000123');
    assert.equal(item.status, 'ready');
  }
});

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
    'sku-3,Producto,3,10,1,,,true',
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

test('marks catalog SKUs invalid case-insensitively while leaving final uniqueness to the backend', () => {
  const [existing, newItem] = parseProductImportCsv(
    `${headers}\nknown-sku,Producto existente,3,10,1,,,true\nNEW-SKU,Producto nuevo,3,10,1,,,true`,
    categories,
    [{ codigo: 'Known-Sku' }],
  );

  assert.equal(existing.status, 'invalid');
  assert.equal(existing.payload, null);
  assert.ok(existing.errors.some((error) => error.includes('ya existe en el catálogo')));
  assert.equal(newItem.status, 'ready');
  assert.ok(newItem.payload);
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
      errors: [
        'Error\r\n=HYPERLINK("https://example.test")\u0000',
      ],
    },
    {
      ...item,
      line: 4,
      codigo: '＝1+1',
      nombre: '＋SUM(1,1)',
      errors: ['－1+1 ＠SUM(1,1)'],
    },
  ]);

  assert.equal(createProductImportTemplate(), `${headers}\r\n`);
  assert.ok(report.startsWith('\uFEFF"fila","codigo","nombre"'));
  assert.ok(report.includes('"Producto ""especial"""'));
  assert.ok(report.includes('"Error de validación"'));
  assert.ok(report.includes(`"' =1+1"`));
  assert.ok(report.includes(`"' @SUM(1,1)"`));
  assert.ok(report.includes('＝1+1'));
  assert.ok(report.includes('＋SUM(1,1)'));
  assert.ok(report.includes('－1+1'));
  assert.ok(report.includes('＠SUM(1,1)'));
  assert.ok(report.includes(`"'＝1+1"`));
  assert.ok(report.includes(`"'＋SUM(1,1)"`));
  assert.ok(report.includes(`"'－1+1 ＠SUM(1,1)"`));
  assert.ok(report.includes('Error  =HYPERLINK('));
  assert.equal(/[\u0000-\u001F\u007F-\u009F]/.test(report.replaceAll('\r\n', '')), false);
});

test('parses XLSX rows through the same product contract', async () => {
  xlsxRows = [
    headers.split(','),
    ['SKU-XLSX', 'Taladro', 3, 10.5, 0, 'Descripción', 'https://example.test/img.png', false],
  ];

  const [item] = await parseProductImportXlsx(makeXlsxFile(), categories);
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

test('rejects formula cells with cached values before converting the worksheet', async () => {
  const inlineCell = (reference, value) =>
    `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const headerCells = headers
    .split(',')
    .map((header, index) => inlineCell(`${String.fromCharCode(65 + index)}1`, header))
    .join('');
  const worksheet = `<worksheet><sheetData><row r="1">${headerCells}</row><row r="2"><c r="A2" t="inlineStr"><is><t>SKU-1</t></is></c><c r="B2" t="inlineStr"><is><t>Producto</t></is></c><c r="C2"><v>3</v></c><x:c r="D2"><x:f>5+99</x:f><x:v>10.25</x:v></x:c><c r="E2"><v>1</v></c></row></sheetData></worksheet>`;
  const callsBefore = readSheetCalls;

  await assert.rejects(
    parseProductImportXlsx(makeXlsxFile(worksheet), categories),
    /fila 2, campo "precio"/,
  );
  assert.equal(readSheetCalls, callsBefore);
});

test('rejects formulas with XML-encoded cell coordinates before converting the worksheet', async () => {
  const inlineCell = (reference, value) =>
    `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const headerCells = headers
    .split(',')
    .map((header, index) => inlineCell(`${String.fromCharCode(65 + index)}1`, header))
    .join('');
  const worksheet = `<worksheet><sheetData><row r="1">${headerCells}</row><row r="2"><c r="A2" t="inlineStr"><is><t>SKU-1</t></is></c><c r="B2" t="inlineStr"><is><t>Producto</t></is></c><c r="C2"><v>3</v></c><c r="D&#50;"><f>5+99</f><v>10.25</v></c><c r="E2"><v>1</v></c></row></sheetData></worksheet>`;
  const callsBefore = readSheetCalls;

  await assert.rejects(
    parseProductImportXlsx(makeXlsxFile(worksheet), categories),
    /fila 2, campo "precio"/,
  );
  assert.equal(readSheetCalls, callsBefore);
});

test('rejects XLSX expansion above 24 MB before parsing a small compressed file', async () => {
  const contents = zipSync({
    'xl/worksheets/sheet1.xml': strToU8(
      'x'.repeat(PRODUCT_IMPORT_MAX_UNCOMPRESSED_SIZE + 1),
    ),
  });
  const buffer = contents.buffer.slice(
    contents.byteOffset,
    contents.byteOffset + contents.byteLength,
  );
  const file = {
    size: contents.byteLength,
    arrayBuffer: async () => buffer,
  };
  const callsBefore = readSheetCalls;

  assert.ok(file.size < 26 * 1024);
  await assert.rejects(
    parseProductImportXlsx(file, categories),
    /24 MB descomprimidos/,
  );
  assert.equal(readSheetCalls, callsBefore);
});

test('rejects a 27 KB XLSX with conflicting ZIP directories before parsing', async () => {
  const file = makeAmbiguousXlsxFile();
  const callsBefore = readSheetCalls;

  assert.ok(file.size < 28 * 1024);
  await assert.rejects(
    parseProductImportXlsx(file, categories),
    /directorios ZIP ambiguos/,
  );
  assert.equal(readSheetCalls, callsBefore);
});

test('rejects STORE entries whose declared size is smaller than the extracted block', async () => {
  const file = makeSharedStoredBlockXlsxFile(1);
  const callsBefore = unzipSyncCalls;

  assert.ok(file.size < PRODUCT_IMPORT_MAX_FILE_SIZE);
  await assert.rejects(
    parseProductImportXlsx(file, categories),
    /entrada STORE con tamaños ZIP inconsistentes/,
  );
  assert.equal(unzipSyncCalls, callsBefore);
});

test('enforces the XLSX expansion budget before extracting shared STORE blocks', async () => {
  const file = makeSharedStoredBlockXlsxFile(2 * 1024 * 1024);
  const callsBefore = unzipSyncCalls;

  assert.ok(file.size < PRODUCT_IMPORT_MAX_FILE_SIZE);
  await assert.rejects(
    parseProductImportXlsx(file, categories),
    /24 MB descomprimidos/,
  );
  assert.equal(unzipSyncCalls, callsBefore);
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