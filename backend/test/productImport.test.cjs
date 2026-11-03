const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const zlib = require('node:zlib');

// Ningún test unitario usa credenciales ni conexiones reales.
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

before(async () => {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/productos/importar/validar`;
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await destroyDatabase();
});

function buildTestXlsxBuffer(rows) {
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
                cellsXml += `<c r="${ref}" t="n"><v>${cellVal}</v></c>`;
            } else if (typeof cellVal === 'boolean') {
                cellsXml += `<c r="${ref}" t="b"><v>${cellVal ? 1 : 0}</v></c>`;
            } else {
                const sIdx = getSharedIndex(String(cellVal ?? ''));
                cellsXml += `<c r="${ref}" t="s"><v>${sIdx}</v></c>`;
            }
        });
        sheetRowsXml += `<row r="${rowNum}">${cellsXml}</row>`;
    });

    const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${sheetRowsXml}</sheetData></worksheet>`;
    const sharedXml = `<?xml version="1.0" encoding="UTF-8"?><sst>${sharedStrings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;

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

test('Product Import Service & Endpoint - Unit Tests (#235)', async (t) => {
    t.beforeEach(() => {
        test.mock.method(repo, 'findExistingSkus', async () => new Set(['SKU-DB-1']));
        test.mock.method(repo, 'findExistingCategoryIds', async () => new Set([1, 2]));
    });

    t.afterEach(() => {
        test.mock.restoreAll();
    });

    await t.test('Valida correctamente un archivo CSV con una fila válida', async () => {
        const csv = 'codigo,nombre,id_categoria,precio,stock,activo\nSKU-NEW,Nuevo Producto,1,150.25,10,true';
        const buffer = Buffer.from(csv, 'utf8');
        const report = await validateProductImportFile(buffer, 'plantilla.csv');

        assert.equal(report.valid, true);
        assert.equal(report.totalRows, 1);
        assert.equal(report.validRowsCount, 1);
        assert.equal(report.invalidRowsCount, 0);
        assert.equal(report.duplicateInFileCount, 0);
        assert.equal(report.existingInDbCount, 0);
        assert.equal(report.errors.length, 0);
        assert.equal(report.validRows[0].codigo, 'SKU-NEW');
    });

    await t.test('Valida correctamente un archivo XLSX generado en memoria', async () => {
        const buffer = buildTestXlsxBuffer([
            ['codigo', 'nombre', 'id_categoria', 'precio', 'stock', 'activo'],
            ['SKU-XLSX', 'Prod Excel', 2, 99.99, 5, 'si']
        ]);

        const report = await validateProductImportFile(buffer, 'plantilla.xlsx');
        assert.equal(report.valid, true);
        assert.equal(report.validRowsCount, 1);
        assert.equal(report.validRows[0].codigo, 'SKU-XLSX');
        assert.equal(report.validRows[0].activo, true);
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

    await t.test('Falla si faltan columnas obligatorias', async () => {
        const csv = 'codigo,nombre,precio\nSKU-1,Prod,100';
        const buffer = Buffer.from(csv, 'utf8');
        await assert.rejects(
            validateProductImportFile(buffer, 'test.csv'),
            (err) => err instanceof FileImportValidationError && err.message.includes('Falta la columna obligatoria')
        );
    });

    await t.test('Detecta errores de DTO (precio negativo, stock negativo y categoría inexistente)', async () => {
        const csv = 'codigo,nombre,id_categoria,precio,stock\nSKU-ERR,Prod,99,-5.50,-10';
        const buffer = Buffer.from(csv, 'utf8');
        const report = await validateProductImportFile(buffer, 'test.csv');

        assert.equal(report.valid, false);
        assert.equal(report.invalidRowsCount, 1);
        const fieldsInError = report.errors.map((e) => e.field);
        assert.ok(fieldsInError.includes('id_categoria'));
        assert.ok(fieldsInError.includes('precio'));
        assert.ok(fieldsInError.includes('stock'));
    });

    await t.test('Detecta SKUs duplicados dentro del mismo archivo', async () => {
        const csv = 'codigo,nombre,id_categoria,precio,stock\nDUP-1,Prod 1,1,100,10\nDUP-1,Prod 2,1,200,20';
        const buffer = Buffer.from(csv, 'utf8');
        const report = await validateProductImportFile(buffer, 'test.csv');

        assert.equal(report.valid, false);
        assert.equal(report.duplicateInFileCount, 1);
        const dupError = report.errors.find((e) => e.field === 'codigo' && e.message.includes('repetido dentro del archivo'));
        assert.ok(dupError);
        assert.equal(dupError.row, 3);
    });

    await t.test('Detecta SKUs que ya existen en la base de datos', async () => {
        const csv = 'codigo,nombre,id_categoria,precio,stock\nSKU-DB-1,Prod Existente,1,100,10';
        const buffer = Buffer.from(csv, 'utf8');
        const report = await validateProductImportFile(buffer, 'test.csv');

        assert.equal(report.valid, false);
        assert.equal(report.existingInDbCount, 1);
        const dbError = report.errors.find((e) => e.field === 'codigo' && e.message.includes('ya existe en la base de datos'));
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
        const csvContent = 'codigo,nombre,id_categoria,precio,stock\nSKU-HTTP-1,Martillo,1,2500.50,15';
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
    });
    await t.test('H01: detecta SKUs equivalentes con acentos (CAFE/café) en archivo', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio,stock\nCAFE,A,1,10,1\ncafé,B,1,10,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test.csv');
        assert.strictEqual(report.valid, false);
        assert.strictEqual(report.duplicateInFileCount, 1);
    });

    await t.test('H02: rechaza decimales con exceso de escala que perderían precisión', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio,stock\nSKU-1,A,1,1.00000000000001,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test.csv');
        assert.strictEqual(report.valid, false);
        assert.ok(report.errors.some((e) => e.field === 'precio'));
    });
    await t.test('H01: AE y Æ se detectan como distintos (no duplican) según reglas SQL', async () => {
        const csv = Buffer.from('codigo,nombre,id_categoria,precio,stock\nAE,A,1,10,1\nÆ,B,1,10,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test.csv');

        assert.equal(report.duplicateInFileCount, 0);
        // Valid porque la BD (y el Collator) los trata como distintos
        assert.equal(report.valid, true);
    });

    await t.test('H01: AB y A\\u200DB (zero-width joiner invisible) se detectan como colisión', async () => {
        // \u200D es un carácter invisible que SQL y el Collator ignoran, por lo que cuentan como el mismo SKU.
        const csv = Buffer.from('codigo,nombre,id_categoria,precio,stock\nAB,A,1,10,1\nA\u200DB,B,1,10,1\n', 'utf8');
        const report = await validateProductImportFile(csv, 'test.csv');

        assert.equal(report.valid, false);
        assert.equal(report.duplicateInFileCount, 1);
        const dupError = report.errors.find((e) => e.field === 'codigo' && e.message.includes('repetido dentro del archivo'));
        assert.ok(dupError);
    });
    await t.test('H03: XLSX con inlineStr y fragmentos <t> múltiples conserva el texto completo', async () => {
        // Simula celda con inlineStr dividida en múltiples etiquetas <t>
        const sheetXml = '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>' +
            '<row r="1"><c r="A1" t="inlineStr"><is><t>codigo</t></is></c><c r="B1" t="inlineStr"><is><t>nombre</t></is></c><c r="C1" t="inlineStr"><is><t>id_categoria</t></is></c><c r="D1" t="inlineStr"><is><t>precio</t></is></c><c r="E1" t="inlineStr"><is><t>stock</t></is></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>SKU-</t><t>COMPLETO</t></is></c><c r="B2" t="inlineStr"><is><t>Prod</t></is></c><c r="C2" t="n"><v>1</v></c><c r="D2" t="n"><v>100</v></c><c r="E2" t="n"><v>5</v></c></row>' +
            '</sheetData></worksheet>';

        const zip = require('node:zlib');
        const deflate = (buf) => zip.deflateRawSync(buf);
        const fName = Buffer.from('xl/worksheets/sheet1.xml');
        const fData = Buffer.from(sheetXml, 'utf8');
        const fComp = deflate(fData);

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

        const cd = Buffer.concat([ch, fName]);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(cd.length, 12);
        eocd.writeUInt32LE(lh.length + fName.length + fComp.length, 16);

        const xlsxBuf = Buffer.concat([lh, fName, fComp, cd, eocd]);
        const report = await validateProductImportFile(xlsxBuf, 'inline_str.xlsx');

        assert.equal(report.valid, true);
        assert.equal(report.validRows[0].codigo, 'SKU-COMPLETO');
    });

    await t.test('H04: rechaza archivo XLSX que excede el presupuesto de descompresión (Zip Bomb)', async () => {
        // XML que infla a más de 10 MiB para disparar el guard de descompresión
        const hugePayload = Buffer.from('<worksheet>' + ' '.repeat(11 * 1024 * 1024) + '</worksheet>', 'utf8');
        const zip = require('node:zlib');
        const comp = zip.deflateRawSync(hugePayload);
        const name = Buffer.from('xl/worksheets/sheet1.xml');

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(8, 8);
        lh.writeUInt32LE(comp.length, 18);
        lh.writeUInt32LE(hugePayload.length, 22);
        lh.writeUInt16LE(name.length, 26);

        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(8, 10);
        ch.writeUInt32LE(comp.length, 20);
        ch.writeUInt32LE(hugePayload.length, 24);
        ch.writeUInt16LE(name.length, 28);

        const cd = Buffer.concat([ch, name]);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(cd.length, 12);
        eocd.writeUInt32LE(lh.length + name.length + comp.length, 16);

        const bombBuf = Buffer.concat([lh, name, comp, cd, eocd]);

        await assert.rejects(
            validateProductImportFile(bombBuf, 'bomb.xlsx'),
            (err) => err instanceof FileImportValidationError && (err.message.includes('límite') || err.message.includes('tamaño') || err.message.includes('descompresión') || err.message.includes('corrupto'))
        );
    });
});
