const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const zlib = require('node:zlib');

Object.assign(process.env, {
    JWT_SECRET: randomUUID(),
    DB_HOST: '127.0.0.1',
    DB_PORT: '1',
    DB_NAME: randomUUID(),
    DB_USER: randomUUID(),
    DB_PASSWORD: randomUUID()
});

const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
const { destroyDatabase } = require('../dist/config/database.config.js');
const { signToken } = require('../dist/services/token.service.js');
const usuarioRepo = require('../dist/repositories/usuario.repository.js');
const repo = require('../dist/repositories/productImport.repository.js');
const {
    validateProductImportFile,
    FileImportValidationError
} = require('../dist/services/productImport.service.js');
const { app } = require('../dist/app.js');

let server;
let baseUrl;
let importBaseUrl;

before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/admin/productos/importar/validar`;
    importBaseUrl = `http://127.0.0.1:${port}/api/admin/productos/importar`;
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await destroyDatabase();
});

function buildTestXlsxBuffer(rows, prefix = '') {
    const p = prefix ? `${prefix}:` : '';
    const ns = prefix ? ` xmlns:${prefix}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` : '';
    const sharedStrings = [];
    const getSharedIndex = (str) => {
        let idx = sharedStrings.indexOf(str);
        if (idx === -1) {
            idx = sharedStrings.length;
            sharedStrings.push(str);
        }
        return idx;
    };

    const colLetter = (idx) => String.fromCharCode(65 + idx);
    let sheetRowsXml = '';

    rows.forEach((row, rIdx) => {
        const rowNum = rIdx + 1;
        let cellsXml = '';
        row.forEach((cellVal, cIdx) => {
            const ref = `${colLetter(cIdx)}${rowNum}`;
            if (typeof cellVal === 'number') {
                cellsXml += `<${p}c r="${ref}" t="n"><${p}v>${cellVal}</${p}v></${p}c>`;
            } else if (typeof cellVal === 'boolean') {
                cellsXml += `<${p}c r="${ref}" t="b"><${p}v>${cellVal ? 1 : 0}</${p}v></${p}c>`;
            } else {
                const sIdx = getSharedIndex(String(cellVal ?? ''));
                cellsXml += `<${p}c r="${ref}" t="s"><${p}v>${sIdx}</${p}v></${p}c>`;
            }
        });
        sheetRowsXml += `<${p}row r="${rowNum}">${cellsXml}</${p}row>`;
    });

    const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><${p}worksheet${ns}><${p}sheetData>${sheetRowsXml}</${p}sheetData></${p}worksheet>`;
    const sharedXml = `<?xml version="1.0" encoding="UTF-8"?><${p}sst${ns}>${sharedStrings.map((s) => `<${p}si><${p}t>${s}</${p}t></${p}si>`).join('')}</${p}sst>`;

    const files = [
        { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml, 'utf8') },
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8') }
    ];

    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const nameBuf = Buffer.from(file.name, 'utf8');
        const compressed = zlib.deflateRawSync(file.data);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(file.data.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(file.data.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt32LE(offset, 42);

        localParts.push(localHeader, nameBuf, compressed);
        centralParts.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + compressed.length;
    }

    const centralDirBuffer = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDirBuffer.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...localParts, centralDirBuffer, eocd]);
}

test('Product Import Service & Endpoint - Unit Tests (#235 & #236)', async (t) => {
    t.beforeEach(() => {
        repo.clearMockInsertedProducts();
        test.mock.method(repo, 'findExistingSkus', async () => new Set(['SKU-DB-1']));
        test.mock.method(repo, 'findExistingCategoryIds', async () => new Set([1, 2]));
    });

    t.afterEach(() => {
        test.mock.restoreAll();
    });

    await t.test('Valida correctamente un archivo CSV con una fila válida (FER16-v2)', async () => {
        const csv = 'codigo,nombre,id_categoria,precio_base_usd,stock,activo\nSKU-NEW,Nuevo Producto,1,150.25,10,true';
        const buffer = Buffer.from(csv, 'utf8');
        const report = await validateProductImportFile(buffer, 'plantilla.csv');

        assert.equal(report.valid, true);
        assert.equal(report.totalRows, 1);
        assert.equal(report.validRowsCount, 1);
        assert.equal(report.invalidRowsCount, 0);
        assert.equal(report.duplicateInFileCount, 0);
        assert.equal(report.existingInDbCount, 0);
        assert.equal(report.errors.length, 0);
        assert.equal(report.validRows[0].producto.codigo, 'SKU-NEW');
        assert.equal(report.validRows[0].producto.precio_base_usd, '150.25');
    });

    await t.test('Valida correctamente un archivo XLSX generado en memoria (FER16-v2)', async () => {
        const buffer = buildTestXlsxBuffer([
            ['codigo', 'nombre', 'id_categoria', 'precio_base_usd', 'stock', 'activo'],
            ['SKU-XLSX', 'Prod Excel', 2, 99.99, 5, 'si']
        ]);

        const report = await validateProductImportFile(buffer, 'plantilla.xlsx');
        assert.equal(report.valid, true);
        assert.equal(report.validRowsCount, 1);
        assert.equal(report.validRows[0].producto.codigo, 'SKU-XLSX');
        assert.equal(report.validRows[0].producto.activo, true);
    });

    await t.test('Rechaza extensiones no soportadas y archivos XLSX malformados', async () => {
        const buffer = Buffer.from('dummy', 'utf8');
        await assert.rejects(
            validateProductImportFile(buffer, 'archivo.txt'),
            (err) => err instanceof FileImportValidationError && err.message.includes('Extensión de archivo no soportada')
        );

        await assert.rejects(
            validateProductImportFile(buffer, 'corrupto.xlsx'),
            (err) => err instanceof FileImportValidationError && err.message.includes('malformado o corrupto')
        );
    });

    await t.test('Falla si faltan columnas obligatorias o si usa encabezado antiguo precio', async () => {
        const csvMissing = 'codigo,nombre,precio_base_usd\nSKU-1,Prod,100';
        await assert.rejects(
            validateProductImportFile(Buffer.from(csvMissing, 'utf8'), 'test.csv'),
            (err) => err instanceof FileImportValidationError && err.message.includes('Falta la columna obligatoria')
        );

        const csvLegacy = 'codigo,nombre,id_categoria,precio,stock\nSKU-OLD,Prod,1,100,5';
        await assert.rejects(
            validateProductImportFile(Buffer.from(csvLegacy, 'utf8'), 'legacy.csv'),
            (err) => err instanceof FileImportValidationError && err.message.includes('FER16-v2')
        );
    });

    await t.test('Detecta errores de DTO (precio negativo, stock negativo y categoría inexistente)', async () => {
        const csv = 'codigo,nombre,id_categoria,precio_base_usd,stock\nSKU-ERR,Prod,99,-5.50,-10';
        const buffer = Buffer.from(csv, 'utf8');
        const report = await validateProductImportFile(buffer, 'test.csv');

        assert.equal(report.valid, false);
        assert.equal(report.invalidRowsCount, 1);
        const fieldsInError = report.errors.map((e) => e.field);
        assert.ok(fieldsInError.includes('id_categoria'));
        assert.ok(fieldsInError.includes('precio_base_usd'));
        assert.ok(fieldsInError.includes('stock'));
    });

    await t.test('Detecta SKUs duplicados dentro del mismo archivo', async () => {
        const csv = 'codigo,nombre,id_categoria,precio_base_usd,stock\nDUP-1,Prod 1,1,100,10\nDUP-1,Prod 2,1,200,20';
        const buffer = Buffer.from(csv, 'utf8');
        const report = await validateProductImportFile(buffer, 'test.csv');

        assert.equal(report.valid, false);
        assert.equal(report.duplicateInFileCount, 1);
        const dupError = report.errors.find((e) => e.field === 'codigo' && e.code === 'DUPLICATE_SKU_IN_FILE');
        assert.ok(dupError);
        assert.equal(dupError.row, 3);
    });

    await t.test('Detecta SKUs que ya existen en la base de datos', async () => {
        const csv = 'codigo,nombre,id_categoria,precio_base_usd,stock\nSKU-DB-1,Prod Existente,1,100,10';
        const buffer = Buffer.from(csv, 'utf8');
        const report = await validateProductImportFile(buffer, 'test.csv');

        assert.equal(report.valid, false);
        assert.equal(report.existingInDbCount, 1);
        const dbError = report.errors.find((e) => e.field === 'codigo' && e.code === 'SKU_EXISTS');
        assert.ok(dbError);
    });

    await t.test('Endpoint exclusivo ADMIN: rechaza 401 sin sesión y 403 para rol CLIENTE', async () => {
        const noAuthRes = await fetch(baseUrl, { method: 'POST' });
        assert.equal(noAuthRes.status, 401);

        test.mock.method(usuarioRepo, 'findUsuarioById', async () => ({
            id_usuario: 2,
            email: 'cliente@test.com',
            rol: 'CLIENTE',
            activo: 1,
            nombre_razon_social: 'Cliente',
            tipo_cliente: 'PARTICULAR'
        }));

        const clienteToken = signToken({ id: 2, rol: 'CLIENTE' });
        const clienteRes = await fetch(baseUrl, {
            method: 'POST',
            headers: { Cookie: `jwt_token=${clienteToken}` }
        });
        assert.equal(clienteRes.status, 403);
    });

    await t.test('Endpoint ADMIN: procesa multipart/form-data CSV y devuelve reporte 200 sin persistir', async () => {
        test.mock.method(usuarioRepo, 'findUsuarioById', async () => ({
            id_usuario: 1,
            email: 'admin@test.com',
            rol: 'ADMIN',
            activo: 1,
            nombre_razon_social: null,
            tipo_cliente: null
        }));

        const adminToken = signToken({ id: 1, rol: 'ADMIN' });
        const form = new FormData();
        const csvContent = 'codigo,nombre,id_categoria,precio_base_usd,stock\nSKU-HTTP-1,Martillo,1,2500.50,15';
        form.append('file', new Blob([csvContent], { type: 'text/csv' }), 'productos.csv');

        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { Cookie: `jwt_token=${adminToken}` },
            body: form
        });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.valid, true);
        assert.equal(body.totalRows, 1);
        assert.equal(body.validRowsCount, 1);
        assert.equal(body.version, 'FER16-v2');
    });

    await t.test('Rechaza productos asignados a categorías inactivas o inexistentes', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio_base_usd,stock\nSKU-CAT-INACTIVA,Prod,3,100,5\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test.csv');

        assert.equal(report.valid, false);
        const catError = report.errors.find((e) => e.field === 'id_categoria');
        assert.ok(catError);
        assert.match(catError.message, /no existe o no se encuentra activa/);
    });

    await t.test('H01: detecta SKUs equivalentes con acentos (CAFE/café) en archivo', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio_base_usd,stock\nCAFE,A,1,10,1\ncafé,B,1,10,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test.csv');
        assert.strictEqual(report.valid, false);
        assert.strictEqual(report.duplicateInFileCount, 1);
    });

    await t.test('H02: rechaza decimales con exceso de escala que perderían precisión', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio_base_usd,stock\nSKU-1,A,1,1.00000000000001,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test.csv');
        assert.strictEqual(report.valid, false);
        assert.ok(report.errors.some((e) => e.field === 'precio_base_usd'));
    });

    await t.test('H03: XLSX con inlineStr y fragmentos <t> múltiples conserva el texto completo', async () => {
        const sheetXml = '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>' +
            '<row r="1"><c r="A1" t="inlineStr"><is><t>codigo</t></is></c><c r="B1" t="inlineStr"><is><t>nombre</t></is></c><c r="C1" t="inlineStr"><is><t>id_categoria</t></is></c><c r="D1" t="inlineStr"><is><t>precio_base_usd</t></is></c><c r="E1" t="inlineStr"><is><t>stock</t></is></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>SKU-</t><t>COMPLETO</t></is></c><c r="B2" t="inlineStr"><is><t>Prod</t></is></c><c r="C2" t="n"><v>1</v></c><c r="D2" t="n"><v>100</v></c><c r="E2" t="n"><v>5</v></c></row>' +
            '</sheetData></worksheet>';

        const fName = Buffer.from('xl/worksheets/sheet1.xml');
        const fData = Buffer.from(sheetXml, 'utf8');
        const fComp = zlib.deflateRawSync(fData);

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(8, 8);
        lh.writeUInt32LE(fComp.length, 18);
        lh.writeUInt32LE(fData.length, 22);
        lh.writeUInt16LE(fName.length, 26);

        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(8, 10);
        ch.writeUInt32LE(fComp.length, 20);
        ch.writeUInt32LE(fData.length, 24);
        ch.writeUInt16LE(fName.length, 28);

        const zipBuffer = Buffer.concat([
            lh, fName, fComp,
            ch, fName,
            Buffer.from([
                0x50, 0x4b, 0x05, 0x06,
                0x00, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x01, 0x00,
                (46 + fName.length) & 0xff, ((46 + fName.length) >> 8) & 0xff, 0x00, 0x00,
                (30 + fName.length + fComp.length) & 0xff, ((30 + fName.length + fComp.length) >> 8) & 0xff, 0x00, 0x00,
                0x00, 0x00
            ])
        ]);

        const report = await validateProductImportFile(zipBuffer, 'inline.xlsx');
        assert.equal(report.valid, true);
        assert.equal(report.validRows[0].producto.codigo, 'SKU-COMPLETO');
    });

    await t.test('H04: rechaza archivo XLSX que excede el presupuesto de descompresión (Zip Bomb)', async () => {
        const bigXml = Buffer.alloc(11 * 1024 * 1024, 0x20);
        const comp = zlib.deflateRawSync(bigXml);
        const nameBuf = Buffer.from('xl/worksheets/sheet1.xml');

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(8, 8);
        lh.writeUInt32LE(comp.length, 18);
        lh.writeUInt32LE(bigXml.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);

        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(8, 10);
        ch.writeUInt32LE(comp.length, 20);
        ch.writeUInt32LE(bigXml.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);

        const zipBomb = Buffer.concat([
            lh, nameBuf, comp,
            ch, nameBuf,
            Buffer.from([
                0x50, 0x4b, 0x05, 0x06,
                0x00, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x01, 0x00,
                (46 + nameBuf.length) & 0xff, ((46 + nameBuf.length) >> 8) & 0xff, 0x00, 0x00,
                (30 + nameBuf.length + comp.length) & 0xff, ((30 + nameBuf.length + comp.length) >> 8) & 0xff, 0x00, 0x00,
                0x00, 0x00
            ])
        ]);

        await assert.rejects(
            validateProductImportFile(zipBomb, 'bomb.xlsx'),
            (err) => err instanceof FileImportValidationError && err.message.includes('límite seguro de memoria acumulada')
        );
    });

    await t.test('H01: AE y Æ se detectan como distintos (no duplican) según reglas SQL', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio_base_usd,stock\nAE,A,1,10,1\nÆ,B,1,10,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test-ae.csv');
        assert.strictEqual(report.valid, true);
        assert.strictEqual(report.duplicateInFileCount, 0);
    });

    await t.test('H01: AB y A\\u200DB (zero-width joiner invisible) se detectan como colisión', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio_base_usd,stock\nAB,A,1,10,1\nA\u200DB,B,1,10,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test-zwj.csv');
        assert.equal(report.valid, false);
        assert.equal(report.duplicateInFileCount, 1);
    });

    await t.test('H01: ss y ß se detectan como colisión según reglas SQL', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio_base_usd,stock\nss,A,1,10,1\nß,B,1,10,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test-ss.csv');
        assert.equal(report.valid, false);
        assert.equal(report.duplicateInFileCount, 1);
    });

    await t.test('H05: valida correctamente XLSX con etiquetas prefijadas con namespaces XML (x:row, x:c, x:v)', async () => {
        const buffer = buildTestXlsxBuffer([
            ['codigo', 'nombre', 'id_categoria', 'precio_base_usd', 'stock', 'activo'],
            ['000123', 'Taladro', 1, 250.50, 10, true]
        ], 'x');

        const report = await validateProductImportFile(buffer, 'prefixed.xlsx');
        assert.equal(report.valid, true);
        assert.equal(report.validRowsCount, 1);
        assert.equal(report.validRows[0].producto.codigo, '000123');
        assert.equal(report.validRows[0].producto.nombre, 'Taladro');
        assert.equal(report.validRows[0].producto.id_categoria, 1);
        assert.equal(report.validRows[0].producto.precio_base_usd, '250.50');
        assert.equal(report.validRows[0].producto.stock, 10);
        assert.equal(report.validRows[0].producto.activo, true);
    });

    // --- Regresiones Auditoría Task #236 (H01 - H04) ---

    await t.test('Auditoría H01: Rechaza confirmar sin token válido, token ajeno o filas sustituidas en body', async () => {
        test.mock.method(usuarioRepo, 'findUsuarioById', async (id) => ({
            id_usuario: Number(id),
            email: `admin${id}@test.com`,
            rol: 'ADMIN',
            activo: 1
        }));
        const admin1Token = signToken({ id: 1, rol: 'ADMIN' });

        const badBodyRes = await fetch(`${importBaseUrl}/confirmar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: `jwt_token=${admin1Token}`
            },
            body: JSON.stringify({ previewToken: 'dummy', items: [{ codigo: 'FAKE' }] })
        });
        assert.equal(badBodyRes.status, 400);

        const csv = 'codigo,nombre,id_categoria,precio_base_usd,stock\nH01-SKU,Admin 1 Prod,1,100,5';
        const previewReport = await validateProductImportFile(Buffer.from(csv, 'utf8'), 'test.csv', 1);

        const admin2Token = signToken({ id: 999, rol: 'ADMIN' });
        const foreignTokenRes = await fetch(`${importBaseUrl}/confirmar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: `jwt_token=${admin2Token}`
            },
            body: JSON.stringify({ previewToken: previewReport.previewToken })
        });
        assert.equal(foreignTokenRes.status, 404);
    });

    await t.test('Auditoría H02: Conflicto 409 no bloquea el token en PROCESSING permanente y permite resolver', async () => {
        test.mock.method(usuarioRepo, 'findUsuarioById', async () => ({
            id_usuario: 1,
            email: 'admin@test.com',
            rol: 'ADMIN',
            activo: 1
        }));
        const adminToken = signToken({ id: 1, rol: 'ADMIN' });

        const csv1 = 'codigo,nombre,id_categoria,precio_base_usd,stock\nH02-LOCK,Prod 1,1,100,5';
        const csv2 = 'codigo,nombre,id_categoria,precio_base_usd,stock\nH02-LOCK,Prod 2,1,120,5';

        const prev1 = await validateProductImportFile(Buffer.from(csv1, 'utf8'), 'test1.csv', 1);
        const prev2 = await validateProductImportFile(Buffer.from(csv2, 'utf8'), 'test2.csv', 1);

        const { tryAcquireSkuLocks, releaseSkuLocks } = require('../dist/utils/importConfirmationState.util.js');
        tryAcquireSkuLocks(['H02-LOCK']);

        const conflictRes = await fetch(`${importBaseUrl}/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: `jwt_token=${adminToken}` },
            body: JSON.stringify({ previewToken: prev2.previewToken })
        });
        assert.equal(conflictRes.status, 409);

        releaseSkuLocks(['H02-LOCK']);

        const resolveRes = await fetch(`${importBaseUrl}/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: `jwt_token=${adminToken}` },
            body: JSON.stringify({ previewToken: prev2.previewToken })
        });
        assert.equal(resolveRes.status, 200);
        const report = await resolveRes.json();
        assert.equal(report.importados, 1);
    });

    await t.test('Auditoría H03: Mantiene numeración original de filas (row) y descartes de previsualización', async () => {
        test.mock.method(usuarioRepo, 'findUsuarioById', async () => ({
            id_usuario: 1,
            email: 'admin@test.com',
            rol: 'ADMIN',
            activo: 1
        }));
        const adminToken = signToken({ id: 1, rol: 'ADMIN' });

        const csv = [
            'codigo,nombre,id_categoria,precio_base_usd,stock',
            'SKU-INV,Invalido,1,10,-1',
            'SKU-VAL3,Valido Fila 3,1,50,5',
            'SKU-DB-1,Existente,1,10,1'
        ].join('\n');

        const prev = await validateProductImportFile(Buffer.from(csv, 'utf8'), 'mixto.csv', 1);
        assert.equal(prev.validRows.length, 1);
        assert.equal(prev.validRows[0].row, 3);

        const confirmRes = await fetch(`${importBaseUrl}/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: `jwt_token=${adminToken}` },
            body: JSON.stringify({ previewToken: prev.previewToken })
        });

        assert.equal(confirmRes.status, 200);
        const confirmReport = await confirmRes.json();

        assert.equal(confirmReport.totalProcesados, 3);
        assert.equal(confirmReport.importados, 1);
        assert.equal(confirmReport.rechazados, 1);
        assert.equal(confirmReport.omitidos, 1);

        const row2 = confirmReport.detalles.find((d) => d.row === 2);
        const row3 = confirmReport.detalles.find((d) => d.row === 3);
        const row4 = confirmReport.detalles.find((d) => d.row === 4);

        assert.ok(row2 && row2.estado === 'rechazado');
        assert.ok(row3 && row3.estado === 'importado');
        assert.ok(row4 && row4.estado === 'omitido');
    });

    await t.test('Auditoría H04: Commit incierto responde 202 por_verificar y GET /confirmaciones permite conciliar', async () => {
        test.mock.method(usuarioRepo, 'findUsuarioById', async () => ({
            id_usuario: 1,
            email: 'admin@test.com',
            rol: 'ADMIN',
            activo: 1
        }));
        const adminToken = signToken({ id: 1, rol: 'ADMIN' });

        const csv = 'codigo,nombre,id_categoria,precio_base_usd,stock\nSKU-UNCERTAIN,Incierto,1,20,5';
        const prev = await validateProductImportFile(Buffer.from(csv, 'utf8'), 'commit-drop.csv', 1);

        test.mock.method(repo, 'insertImportedProductsBatch', async () => ({
            outcomes: new Map(),
            uncertainRowNumbers: new Set([2])
        }));

        const confirmRes = await fetch(`${importBaseUrl}/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: `jwt_token=${adminToken}` },
            body: JSON.stringify({ previewToken: prev.previewToken })
        });

        assert.equal(confirmRes.status, 202);
        const report = await confirmRes.json();
        assert.equal(report.estado, 'por_verificar');
        assert.equal(report.pendientes, 1);
        assert.equal(report.rechazados, 0);

        const statusRes = await fetch(`${importBaseUrl}/confirmaciones/${prev.previewToken}`, {
            method: 'GET',
            headers: { Cookie: `jwt_token=${adminToken}` }
        });
        assert.equal(statusRes.status, 200);
        const statusReport = await statusRes.json();
        assert.equal(statusReport.previewToken, prev.previewToken);
    });
    await t.test('Auditoría H04 (Rollback + SKU ajeno): la consulta del lote no se apropia de SKUs ajenos tras rollback', async () => {
        test.mock.method(usuarioRepo, 'findUsuarioById', async () => ({
            id_usuario: 1,
            email: 'admin@test.com',
            rol: 'ADMIN',
            activo: 1
        }));
        const adminToken = signToken({ id: 1, rol: 'ADMIN' });

        const csv = 'codigo,nombre,id_categoria,precio_base_usd,stock\nSKU-ROLLBACK,Producto Rollback,1,100,5';
        const prev = await validateProductImportFile(Buffer.from(csv, 'utf8'), 'rollback.csv', 1);

        // Simular que el lote tuvo un rollback en MariaDB
        test.mock.method(repo, 'insertImportedProductsBatch', async () => ({
            outcomes: new Map(),
            uncertainRowNumbers: new Set([2]),
            rolledBackWithoutInsert: true
        }));

        await fetch(`${importBaseUrl}/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: `jwt_token=${adminToken}` },
            body: JSON.stringify({ previewToken: prev.previewToken })
        });

        // Otra operación da de alta el mismo SKU externamente con id_producto = 9999
        test.mock.method(repo, 'findExistingProductsBySkus', async () => {
            const m = new Map();
            m.set('SKU-ROLLBACK', 9999);
            return m;
        });

        // La consulta del lote no debe contar importados: 1 ni id_producto: 9999
        const statusRes = await fetch(`${importBaseUrl}/confirmaciones/${prev.previewToken}`, {
            method: 'GET',
            headers: { Cookie: `jwt_token=${adminToken}` }
        });
        assert.equal(statusRes.status, 200);
        const statusReport = await statusRes.json();
        assert.equal(statusReport.importados, 0);
        const row = statusReport.detalles.find((d) => d.codigo === 'SKU-ROLLBACK');
        assert.notEqual(row?.id_producto, 9999);
        assert.notEqual(row?.estado, 'importado');
    });

    await t.test('Auditoría H05 (Categoría desactivada antes de escritura): rechaza la fila y no confirma el alta', async () => {
        test.mock.method(usuarioRepo, 'findUsuarioById', async () => ({
            id_usuario: 1,
            email: 'admin@test.com',
            rol: 'ADMIN',
            activo: 1
        }));
        const adminToken = signToken({ id: 1, rol: 'ADMIN' });

        const csv = 'codigo,nombre,id_categoria,precio_base_usd,stock\nSKU-CAT-RACE,Prod Race,1,100,5';
        const prev = await validateProductImportFile(Buffer.from(csv, 'utf8'), 'race.csv', 1);

        // Simular que entre validación y escritura la categoría se desactivó dentro de la transacción
        test.mock.method(repo, 'insertImportedProductsBatch', async () => {
            const outcomes = new Map();
            outcomes.set(2, {
                success: false,
                codigo: 'SKU-CAT-RACE',
                nombre: 'Prod Race',
                isCategoryInactive: true,
                error: 'La categoría con ID 1 no existe o no se encuentra activa.'
            });
            return { outcomes, uncertainRowNumbers: new Set(), rolledBackWithoutInsert: false };
        });

        const confirmRes = await fetch(`${importBaseUrl}/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: `jwt_token=${adminToken}` },
            body: JSON.stringify({ previewToken: prev.previewToken })
        });

        assert.equal(confirmRes.status, 200);
        const report = await confirmRes.json();
        assert.equal(report.importados, 0);
        assert.equal(report.rechazados, 1);
        const row = report.detalles.find((d) => d.codigo === 'SKU-CAT-RACE');
        assert.equal(row?.estado, 'rechazado');
        assert.equal(row?.motivos[0]?.field, 'id_categoria');
    });
});