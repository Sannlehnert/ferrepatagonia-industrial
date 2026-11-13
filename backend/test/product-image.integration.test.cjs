const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const sharp = require('sharp');

test('fotos ADMIN con API y MariaDB reales', async t => {
    const database = process.env.ADMIN_PRODUCTS_TEST_DATABASE;
    assert.match(database ?? '', /^admin_products_test_[a-f0-9]{32}$/);
    assert.equal(process.env.DB_NAME, database);
    assert.equal(process.env.DB_HOST, '127.0.0.1');
    const { createAuthUser } = require('./helpers/auth-user.cjs');

    const storage = await mkdtemp(join(tmpdir(), 'ferre-product-images-'));
    const receipts = await mkdtemp(join(tmpdir(), 'ferre-private-receipts-'));
    const { pool } = require('../dist/config/catalog-snapshot.config');
    const users = [];
    let api, category;
    const portProbe = createServer().listen(0, '127.0.0.1');
    await once(portProbe, 'listening');
    const { port } = portProbe.address();
    await new Promise(resolve => portProbe.close(resolve));
    const origin = 'http://127.0.0.1:' + port;
    const base = '/api/admin/productos';

    async function stop() {
        if (!api || api.exitCode !== null || api.signalCode !== null) return;
        const exit = once(api, 'exit');
        api.kill();
        await exit;
    }

    async function start(root = storage) {
        api = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, PORT: String(port), APP_PUBLIC_ORIGIN: origin,
                PRODUCT_IMAGE_STORAGE_DIR: root, RECEIPT_STORAGE_DIR: receipts },
            stdio: 'inherit',
        });
        for (let attempt = 0; attempt < 100; attempt++) {
            assert.equal(api.exitCode, null);
            const response = await fetch(origin + '/api/catalogo?limit=1').catch(() => null);
            if (response?.ok) return;
            await delay(50);
        }
        assert.fail('La API aislada no inició');
    }

    async function fixture(format, width = 24, color = '#126c9e') {
        return sharp({ create: { width, height: 16, channels: 3, background: color } }).toFormat(format).toBuffer();
    }

    function upload(path, method, cookie, product, bytes, type, extra) {
        const form = new FormData();
        form.append('producto', JSON.stringify(product));
        form.append('imagen', new Blob([bytes], { type }), 'original.dat');
        if (extra) form.append('otro', 'campo inesperado');
        return fetch(origin + path, { method, headers: { Origin: origin, ...(cookie && { Cookie: cookie }) }, body: form });
    }

    const [identity] = await pool.query('SELECT DATABASE() AS name');
    assert.equal(identity.name, database);
    try {
        const admin = await createAuthUser(pool);
        users.push(admin);
        const client = await createAuthUser(pool, 'CLIENTE');
        users.push(client);
        const result = await pool.query('INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)', ['Fotos #285']);
        category = Number(result.insertId);
        const product = { nombre: 'Foto de prueba', codigo: 'IMG-' + randomUUID(), precio: 15, stock: 1, id_categoria: category };
        const jpeg = await fixture('jpeg');
        const png = await fixture('png', 30);
        const webp = await fixture('webp', 36);
        const create = (bytes, type, body = product, cookie = admin.cookie, extra) =>
            upload(base + '/con-imagen', 'POST', cookie, body, bytes, type, extra);
        await start();

        await t.test('autenticación y permisos antes de Multer', async () => {
            assert.equal((await create(jpeg, 'image/jpeg', product, null)).status, 401);
            assert.equal((await create(jpeg, 'image/jpeg', product, client.cookie)).status, 403);
            assert.deepEqual(await readdir(storage), []);
        });

        await t.test('rechaza archivos inválidos y respeta límites', async () => {
            for (const [bytes, mime, status] of [
                [Buffer.alloc(0), 'image/jpeg', 400],
                [Buffer.from('<svg/>'), 'image/svg+xml', 415],
                [Buffer.from('MZ'), 'image/png', 415],
                [png, 'image/jpeg', 415],
                [png.subarray(0, 30), 'image/png', 422],
                [await fixture('png', 4097), 'image/png', 422],
                [Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png', 413],
            ]) {
                assert.equal((await create(bytes, mime)).status, status);
            }
            assert.equal((await create(jpeg, 'image/jpeg', product, admin.cookie, true)).status, 400);
            assert.deepEqual(await readdir(storage), []);
        });

        let created;
        await t.test('persiste JPEG y publica WebP en listado y detalle', async () => {
            const response = await create(jpeg, 'image/jpeg');
            assert.equal(response.status, 201, await response.clone().text());
            created = await response.json();
            assert.match(created.imagen, /^\/api\/product-images\/[a-f0-9-]+\.webp$/);
            const [saved] = await pool.query('SELECT imagen FROM PRODUCTO WHERE id_producto = ?', [created.id_producto]);
            assert.equal(saved.imagen, created.imagen);
            const catalog = await (await fetch(origin + '/api/catalogo?busqueda=' + product.codigo)).json();
            assert.equal(catalog.data.productos[0].imagen, created.imagen);
            const detail = await (await fetch(origin + '/api/catalogo/' + created.id_producto)).json();
            assert.equal(detail.data.producto.imagen, created.imagen);
            const photo = await fetch(origin + created.imagen);
            assert.equal(photo.headers.get('content-type'), 'image/webp');
            assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
            assert.equal((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).width, 24);
        });

        await t.test('reinicio de proceso, fallo de almacenamiento y reintento', async () => {
            await stop();
            await start(receipts);
            const denied = await upload(base + '/' + created.id_producto + '/con-imagen', 'PUT', admin.cookie, {}, png, 'image/png');
            assert.equal(denied.status, 503);
            assert.equal((await denied.json()).code, 'PRODUCT_IMAGE_REJECTED');
            assert.deepEqual(await readdir(receipts), []);
            const deniedGet = await fetch(origin + created.imagen);
            assert.equal(deniedGet.status, 503);
            assert.equal(deniedGet.headers.get('cache-control'), 'no-store');
            const deniedGetText = await deniedGet.text();
            assert.equal(JSON.parse(deniedGetText).code, 'PRODUCT_IMAGE_REJECTED');
            assert.equal(deniedGetText.includes(receipts), false);
            const deniedHead = await fetch(origin + created.imagen, { method: 'HEAD' });
            assert.equal(deniedHead.status, 503);
            assert.equal(deniedHead.headers.get('cache-control'), 'no-store');
            assert.equal(await deniedHead.text(), '');
            await stop();
            await start();
            assert.equal((await fetch(origin + created.imagen)).status, 200);
            assert.equal((await fetch(origin + '/api/product-images/..%2Fprivate.webp')).status, 404);
            const edit = await upload(base + '/' + created.id_producto + '/con-imagen', 'PUT', admin.cookie, {}, png, 'image/png');
            assert.equal(edit.status, 200, await edit.clone().text());
            const replacement = await edit.json();
            assert.notEqual(replacement.imagen, created.imagen);
            assert.equal((await fetch(origin + created.imagen)).status, 404);
            const photo = await fetch(origin + replacement.imagen);
            assert.equal((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).width, 30);
            created = replacement;
        });

        await t.test('rollback por SKU duplicado, nuevo intento con WebP y URL externa', async () => {
            const before = await readdir(storage);
            assert.equal((await create(webp, 'image/webp')).status, 409);
            assert.deepEqual(await readdir(storage), before);
            const response = await create(webp, 'image/webp', { ...product, codigo: product.codigo + '-2' });
            assert.equal(response.status, 201, await response.clone().text());
            const other = await response.json();
            const update = imagen => fetch(origin + base + '/' + other.id_producto, {
                method: 'PUT', headers: { Origin: origin, Cookie: admin.cookie, 'Content-Type': 'application/json' },
                body: JSON.stringify({ imagen }),
            });
            assert.equal((await update(created.imagen)).status, 400);
            const external = 'https://example.com/imagen.jpg';
            const updated = await update(external);
            assert.equal(updated.status, 200);
            assert.equal((await updated.json()).imagen, external);
            assert.equal((await fetch(origin + other.imagen)).status, 404);
            assert.deepEqual(await readdir(storage), before);
        });

        await t.test('reemplazos concurrentes conservan solo la foto referenciada', async () => {
            const endpoint = base + '/' + created.id_producto + '/con-imagen';
            const responses = await Promise.all([
                upload(endpoint, 'PUT', admin.cookie, {}, png, 'image/png'),
                upload(endpoint, 'PUT', admin.cookie, {}, webp, 'image/webp'),
            ]);
            assert.deepEqual(responses.map(response => response.status), [200, 200]);
            const [row] = await pool.query('SELECT imagen FROM PRODUCTO WHERE id_producto = ?', [created.id_producto]);
            assert.equal((await fetch(origin + row.imagen)).status, 200);
            assert.deepEqual(await readdir(storage), [row.imagen.split('/').at(-1)]);
        });

        await t.test('resultado incierto conserva la foto hasta la conciliación fuera de línea', async () => {
            await stop();
            const before = await readdir(storage);
            const { DatabaseOutcomeUnknownError } = require('../dist/config/database-policy');
            const { withProductImage } = require('../dist/services/productImage.service');
            const previous = process.env.PRODUCT_IMAGE_STORAGE_DIR;
            process.env.PRODUCT_IMAGE_STORAGE_DIR = storage;
            try {
                await assert.rejects(withProductImage({ buffer: webp, mimetype: 'image/webp' }, () => {
                    throw new DatabaseOutcomeUnknownError();
                }), DatabaseOutcomeUnknownError);
            } finally {
                if (previous === undefined) delete process.env.PRODUCT_IMAGE_STORAGE_DIR;
                else process.env.PRODUCT_IMAGE_STORAGE_DIR = previous;
            }
            const files = await readdir(storage);
            assert.equal(files.length, before.length + 1);
            const orphan = files.find(name => !before.includes(name));
            const reconcile = (...args) => execFileSync(process.execPath, ['scripts/reconcile-product-images.cjs', ...args], {
                env: { ...process.env, PRODUCT_IMAGE_STORAGE_DIR: storage, RECEIPT_STORAGE_DIR: receipts },
                encoding: 'utf8',
            });
            assert.ok(reconcile().includes('Sin referencia: ' + orphan));
            assert.deepEqual(await readdir(storage), files);
            assert.ok(reconcile('--apply-offline').includes('Eliminada: ' + orphan));
            assert.deepEqual(await readdir(storage), before);
        });
    } finally {
        await stop();
        try {
            if (category) {
                await pool.query('DELETE FROM PRODUCTO WHERE id_categoria = ?', [category]);
                await pool.query('DELETE FROM CATEGORIA WHERE id_categoria = ?', [category]);
            }
            for (const user of users.reverse()) await user.destroy();
        } finally {
            await pool.end();
            await Promise.all([storage, receipts].map(path => rm(path, { recursive: true, force: true })));
        }
    }
});
