const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { createAuthUser } = require('./helpers/auth-user.cjs');

assert.match(
    process.env.ADMIN_PRODUCTS_TEST_DATABASE || '',
    /^admin_products_test_[a-f0-9]{32}$/,
    'Use test/helpers/run-admin-products-mariadb.cjs: se requiere una base desechable'
);
assert.equal(process.env.DB_NAME, process.env.ADMIN_PRODUCTS_TEST_DATABASE);

const backendDir = path.resolve(__dirname, '..');

test('Product Import Rollback & Persistence - Real MariaDB Integration', async (t) => {
    const { pool } = require('../dist/config/catalog-snapshot.config.js');
    const { app } = require('../dist/app.js');
    const { normalizeSkuKey } = require('../dist/utils/importConfirmationState.util.js');

    let server;
    let importBaseUrl;
    let storageDir;
    let prevImportDir;
    let adminUser;
    let categoryId;
    const createdSkus = [];

    const previewCsv = async (csvContent, filename) => {
        const form = new FormData();
        form.append('file', new Blob([csvContent], { type: 'text/csv' }), filename);
        const res = await fetch(`${importBaseUrl}/previsualizar`, {
            method: 'POST',
            headers: { Cookie: adminUser.cookie },
            body: form
        });
        assert.equal(res.status, 200);
        return res.json();
    };

    const queryProductsBySkus = async (skus) => {
        const placeholders = skus.map(() => '?').join(', ');
        return pool.query(
            `SELECT id_producto, codigo, nombre, precio, stock FROM PRODUCTO WHERE codigo IN (${placeholders}) ORDER BY id_producto ASC`,
            skus
        );
    };

    const listTempFilesForToken = (token) =>
        fs.readdirSync(storageDir).filter((name) => name.startsWith(`${token}.json.`) && name.endsWith('.tmp'));

    before(async () => {
        prevImportDir = process.env.IMPORT_STORAGE_DIR;
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferre-import-rollback-'));
        process.env.IMPORT_STORAGE_DIR = storageDir;

        const [identity] = await pool.query('SELECT DATABASE() AS name');
        assert.equal(identity.name, process.env.ADMIN_PRODUCTS_TEST_DATABASE);

        adminUser = await createAuthUser(pool, 'ADMIN');
        const catRes = await pool.query(
            'INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)',
            [`Rollback Test ${randomUUID().slice(0, 8)}`]
        );
        categoryId = Number(catRes.insertId);

        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        importBaseUrl = `http://127.0.0.1:${server.address().port}/api/admin/productos/importar`;
    });

    after(async () => {
        try {
            if (server) {
                await new Promise((resolve) => server.close(resolve));
            }
            if (createdSkus.length > 0) {
                const placeholders = createdSkus.map(() => '?').join(', ');
                await pool.query(`DELETE FROM PRODUCTO WHERE codigo IN (${placeholders})`, createdSkus);
            }
            if (categoryId) {
                await pool.query('DELETE FROM CATEGORIA WHERE id_categoria = ?', [categoryId]);
            }
            if (adminUser) {
                await adminUser.destroy();
            }
        } finally {
            await pool.end();
            if (prevImportDir === undefined) delete process.env.IMPORT_STORAGE_DIR;
            else process.env.IMPORT_STORAGE_DIR = prevImportDir;
            if (storageDir) {
                fs.rmSync(storageDir, { recursive: true, force: true });
            }
        }
    });

    await t.test(
        'Falla sostenida antes del COMMIT tras vinculación provisional previa: hace rollback en MariaDB, libera locks y reintenta sin duplicar',
        async (t2) => {
            const suffix = randomUUID().slice(0, 8);
            const sku1 = `SKU-RB1-${suffix}`;
            const sku2 = `SKU-RB2-${suffix}`;
            createdSkus.push(sku1, sku2);

            const csv = [
                'codigo,nombre,id_categoria,precio_base_usd,stock',
                `${sku1},Producto Rollback 1,${categoryId},120.50,4`,
                `${sku2},Producto Rollback 2,${categoryId},250.00,9`
            ].join('\n');

            const preview = await previewCsv(csv, 'rollback-sustained.csv');
            assert.equal(preview.valid, true);
            assert.equal(preview.validRowsCount, 2);

            const token = preview.previewToken;
            const persistedPath = path.join(storageDir, `${token}.json`);
            const originalWriteFileSync = fs.writeFileSync;

            let tokenWritesDuringConfirm = 0;
            let storageFailed = false;
            let observedProvisionalId = null;

            const writeMock = t2.mock.method(fs, 'writeFileSync', (...args) => {
                const targetPath = String(args[0] ?? '');
                const isTargetTokenTemp = targetPath.startsWith(`${persistedPath}.`) && targetPath.endsWith('.tmp');

                if (!isTargetTokenTemp) {
                    return originalWriteFileSync.apply(fs, args);
                }

                tokenWritesDuringConfirm++;
                if (storageFailed || tokenWritesDuringConfirm >= 3) {
                    storageFailed = true;
                    const err = new Error('ENOSPC: no space left on device');
                    err.code = 'ENOSPC';
                    throw err;
                }

                const result = originalWriteFileSync.apply(fs, args);
                if (tokenWritesDuringConfirm === 2) {
                    const provisionalSnapshot = JSON.parse(String(args[1]));
                    const links = new Map(provisionalSnapshot.batchLinkedProducts);
                    observedProvisionalId = links.get(normalizeSkuKey(sku1));
                    assert.ok(
                        typeof observedProvisionalId === 'number' && observedProvisionalId > 0,
                        'Debe existir una vinculación provisional previa antes de fallar la siguiente escritura'
                    );
                }
                return result;
            });

            // 1. Confirmar falla con 503 al fallar la segunda vinculación provisional (antes del COMMIT)
            const failedConfirmRes = await fetch(`${importBaseUrl}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: adminUser.cookie },
                body: JSON.stringify({ previewToken: token })
            });
            assert.equal(failedConfirmRes.status, 503);
            const failedBody = await failedConfirmRes.json();
            assert.equal(failedBody.message.includes(storageDir), false);
            assert.equal(failedBody.message.includes('ENOSPC'), false);
            assert.equal(tokenWritesDuringConfirm >= 3, true);
            assert.deepEqual(listTempFilesForToken(token), []);

            // 2. Verificar en MariaDB real que la transacción completa hizo ROLLBACK (0 productos persistidos)
            const dbRowsAfterRollback = await queryProductsBySkus([sku1, sku2]);
            assert.equal(dbRowsAfterRollback.length, 0);

            // 3. Mientras el almacenamiento sigue fallando, GET /confirmaciones también rechaza con 503
            const unavailableStatusRes = await fetch(`${importBaseUrl}/confirmaciones/${token}`, {
                headers: { Cookie: adminUser.cookie }
            });
            assert.equal(unavailableStatusRes.status, 503);

            // 4. Recuperar almacenamiento y consultar estado: debe quedar 'pendiente' (NO 'completado' ni 'por_verificar')
            storageFailed = false;
            writeMock.mock.restore();

            const statusRes = await fetch(`${importBaseUrl}/confirmaciones/${token}`, {
                headers: { Cookie: adminUser.cookie }
            });
            assert.equal(statusRes.status, 200);
            const statusReport = await statusRes.json();
            assert.equal(statusReport.estado, 'pendiente');
            assert.equal(statusReport.totalProcesados, 2);
            assert.equal(statusReport.importados, 0);
            assert.equal(statusReport.omitidos, 0);
            assert.equal(statusReport.rechazados, 0);
            assert.equal(statusReport.pendientes, 2);
            for (const detail of statusReport.detalles) {
                assert.equal(detail.estado, 'pendiente');
                assert.equal(detail.id_producto, undefined);
            }

            // Verificar que el archivo persistido limpió asociaciones provisionales del intento revertido
            const diskAfterRecovery = JSON.parse(fs.readFileSync(persistedPath, 'utf8'));
            assert.equal(diskAfterRecovery.status, 'pendiente');
            assert.deepEqual(diskAfterRecovery.batchLinkedProducts, []);
            assert.deepEqual(diskAfterRecovery.importedProductIds, []);
            for (const row of diskAfterRecovery.rows) {
                assert.equal(row.estado, 'pendiente');
                assert.equal(row.id_producto, undefined);
            }

            // 5. Reintentar confirmación: los locks SKU se liberaron (no devuelve 409) e inserta ambos productos una sola vez
            const retryRes = await fetch(`${importBaseUrl}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: adminUser.cookie },
                body: JSON.stringify({ previewToken: token })
            });
            assert.equal(retryRes.status, 200);
            const retryReport = await retryRes.json();
            assert.equal(retryReport.estado, 'completado');
            assert.equal(retryReport.totalProcesados, 2);
            assert.equal(retryReport.importados, 2);
            assert.equal(retryReport.omitidos, 0);
            assert.equal(retryReport.rechazados, 0);
            assert.equal(retryReport.pendientes, 0);

            const dbRowsAfterRetry = await queryProductsBySkus([sku1, sku2]);
            assert.equal(dbRowsAfterRetry.length, 2);
            assert.equal(dbRowsAfterRetry[0].codigo, sku1);
            assert.equal(dbRowsAfterRetry[0].precio, '120.50');
            assert.equal(dbRowsAfterRetry[0].stock, 4);
            assert.equal(dbRowsAfterRetry[1].codigo, sku2);
            assert.equal(dbRowsAfterRetry[1].precio, '250.00');
            assert.equal(dbRowsAfterRetry[1].stock, 9);
            assert.notEqual(
                dbRowsAfterRetry[0].id_producto,
                observedProvisionalId,
                'El ID asignado tras el rollback debe corresponder al nuevo INSERT confirmado'
            );

            // 6. Reenvío idempotente no duplica productos
            const replayRes = await fetch(`${importBaseUrl}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: adminUser.cookie },
                body: JSON.stringify({ previewToken: token })
            });
            assert.equal(replayRes.status, 200);
            assert.deepEqual(await replayRes.json(), retryReport);
            assert.equal((await queryProductsBySkus([sku1, sku2])).length, 2);
        }
    );

    await t.test(
        'Falla puntual EACCES antes del COMMIT limpia el disco y permite recuperación desde un proceso Node nuevo',
        async (t2) => {
            const suffix = randomUUID().slice(0, 8);
            const sku1 = `SKU-ONCE1-${suffix}`;
            const sku2 = `SKU-ONCE2-${suffix}`;
            createdSkus.push(sku1, sku2);

            const csv = [
                'codigo,nombre,id_categoria,precio_base_usd,stock',
                `${sku1},Producto Once 1,${categoryId},80.00,2`,
                `${sku2},Producto Once 2,${categoryId},95.00,3`
            ].join('\n');

            const preview = await previewCsv(csv, 'rollback-oneshot.csv');
            const token = preview.previewToken;
            const persistedPath = path.join(storageDir, `${token}.json`);
            const originalWriteFileSync = fs.writeFileSync;

            let tokenWritesDuringConfirm = 0;
            const writeMock = t2.mock.method(fs, 'writeFileSync', (...args) => {
                const targetPath = String(args[0] ?? '');
                const isTargetTokenTemp = targetPath.startsWith(`${persistedPath}.`) && targetPath.endsWith('.tmp');
                if (!isTargetTokenTemp) {
                    return originalWriteFileSync.apply(fs, args);
                }
                tokenWritesDuringConfirm++;
                // Write 1: status procesando. Write 2: provisional link sku1. Write 3: fail on sku2 before COMMIT.
                if (tokenWritesDuringConfirm === 3) {
                    const err = new Error('EACCES: permission denied');
                    err.code = 'EACCES';
                    throw err;
                }
                return originalWriteFileSync.apply(fs, args);
            });

            const failedRes = await fetch(`${importBaseUrl}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: adminUser.cookie },
                body: JSON.stringify({ previewToken: token })
            });
            assert.equal(failedRes.status, 503);
            writeMock.mock.restore();

            assert.equal((await queryProductsBySkus([sku1, sku2])).length, 0);
            assert.deepEqual(listTempFilesForToken(token), []);

            const diskState = JSON.parse(fs.readFileSync(persistedPath, 'utf8'));
            assert.equal(diskState.status, 'pendiente');
            assert.deepEqual(diskState.batchLinkedProducts, []);
            assert.deepEqual(diskState.importedProductIds, []);

            // Simular reinicio de proceso: un proceso nuevo lee el disco, confirma y persiste en MariaDB real
            const childScript = `
                const assert = require('node:assert/strict');
                const { initializeDatabase, destroyDatabase } = require('./dist/config/database.config');
                const { getImportConfirmationStatus, confirmProductImport } = require('./dist/services/productImportConfirm.service');
                (async () => {
                    await initializeDatabase();
                    try {
                        const status = await getImportConfirmationStatus(${JSON.stringify(token)}, ${JSON.stringify(adminUser.id)});
                        assert.equal(status.estado, 'pendiente');
                        assert.equal(status.pendientes, 2);
                        const confirmed = await confirmProductImport({ previewToken: ${JSON.stringify(token)} }, ${JSON.stringify(adminUser.id)});
                        assert.equal(confirmed.estado, 'completado');
                        assert.equal(confirmed.importados, 2);
                    } finally {
                        await destroyDatabase();
                    }
                })().catch((err) => { console.error(err); process.exit(1); });
            `;
            const child = spawnSync(
                process.execPath,
                ['--require', './test/helpers/test-env.cjs', '-e', childScript],
                { cwd: backendDir, env: process.env, encoding: 'utf8' }
            );
            assert.equal(child.status, 0, child.stderr || child.stdout);

            const dbRows = await queryProductsBySkus([sku1, sku2]);
            assert.equal(dbRows.length, 2);
        }
    );

    await t.test(
        'Contraste post-COMMIT: si falla el guardado final tras COMMIT en MariaDB, conserva vínculo y concilia sin duplicar',
        async (t2) => {
            const suffix = randomUUID().slice(0, 8);
            const sku1 = `SKU-POST1-${suffix}`;
            const sku2 = `SKU-POST2-${suffix}`;
            createdSkus.push(sku1, sku2);

            const csv = [
                'codigo,nombre,id_categoria,precio_base_usd,stock',
                `${sku1},Producto Post Commit 1,${categoryId},50.00,1`,
                `${sku2},Producto Post Commit 2,${categoryId},75.00,2`
            ].join('\n');

            const preview = await previewCsv(csv, 'post-commit-fail.csv');
            const token = preview.previewToken;
            const persistedPath = path.join(storageDir, `${token}.json`);
            const originalWriteFileSync = fs.writeFileSync;

            let tokenWritesDuringConfirm = 0;
            const writeMock = t2.mock.method(fs, 'writeFileSync', (...args) => {
                const targetPath = String(args[0] ?? '');
                const isTargetTokenTemp = targetPath.startsWith(`${persistedPath}.`) && targetPath.endsWith('.tmp');
                if (!isTargetTokenTemp) {
                    return originalWriteFileSync.apply(fs, args);
                }
                tokenWritesDuringConfirm++;
                // Write 1: procesando, Write 2: sku1 link, Write 3: sku2 link, Write 4: final completado after COMMIT.
                if (tokenWritesDuringConfirm === 4) {
                    const err = new Error('ENOSPC: no space left on device');
                    err.code = 'ENOSPC';
                    throw err;
                }
                return originalWriteFileSync.apply(fs, args);
            });

            const failedFinalSaveRes = await fetch(`${importBaseUrl}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: adminUser.cookie },
                body: JSON.stringify({ previewToken: token })
            });
            assert.equal(failedFinalSaveRes.status, 503);
            writeMock.mock.restore();

            // En este escenario el COMMIT sí ocurrió en MariaDB
            const dbRows = await queryProductsBySkus([sku1, sku2]);
            assert.equal(dbRows.length, 2);

            const diskBeforeReconcile = JSON.parse(fs.readFileSync(persistedPath, 'utf8'));
            assert.equal(diskBeforeReconcile.status, 'procesando');
            assert.equal(diskBeforeReconcile.batchLinkedProducts.length, 2);

            const reconciledRes = await fetch(`${importBaseUrl}/confirmaciones/${token}`, {
                headers: { Cookie: adminUser.cookie }
            });
            assert.equal(reconciledRes.status, 200);
            const reconciledReport = await reconciledRes.json();
            assert.equal(reconciledReport.estado, 'completado');
            assert.equal(reconciledReport.importados, 2);
            assert.deepEqual(
                reconciledReport.detalles.map((d) => d.id_producto).sort((a, b) => a - b),
                dbRows.map((r) => r.id_producto).sort((a, b) => a - b)
            );

            // Reintentar no duplica
            const retryRes = await fetch(`${importBaseUrl}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: adminUser.cookie },
                body: JSON.stringify({ previewToken: token })
            });
            assert.equal(retryRes.status, 200);
            assert.equal((await queryProductsBySkus([sku1, sku2])).length, 2);
        }
    );
});
