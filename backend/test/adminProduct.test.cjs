require('dotenv/config'); // Carga el .env automáticamente
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const RUN_ID = Date.now();
const TEST_PREFIX = `TEST-RUN-${RUN_ID}-SKU-`;

const BASE_URL = 'http://localhost:3000/api';

const createdProductIds = [];

// Helper para ejecutar el archivo SQL de migración eliminando directivas DELIMITER de cliente CLI
const runMigrationSql = async (pool) => {
    const sqlPath = path.resolve(__dirname, '../../database/migrate-uq-producto-codigo.sql');
    const rawSql = fs.readFileSync(sqlPath, 'utf8');
    const blockMatch = rawSql.match(/BEGIN NOT ATOMIC[\s\S]*?END\s*(?=\/\/)/);
    assert.ok(blockMatch, 'No se encontró el bloque BEGIN NOT ATOMIC en migrate-uq-producto-codigo.sql');
    await pool.query(blockMatch[0]);
};

describe('Admin Products Endpoints (#197)', () => {
    let adminCookie = '';
    let clientCookie = '';

    before(() => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('No se encontró JWT_SECRET en el entorno.');

        const adminToken = jwt.sign({ id: 4, rol: 'ADMIN' }, secret, { expiresIn: '2h' });
        adminCookie = `jwt_token=${adminToken}`;

        const clientToken = jwt.sign({ id: 1, rol: 'CLIENTE' }, secret, { expiresIn: '2h' });
        clientCookie = `jwt_token=${clientToken}`;
    });

    it('should return 401 when unauthenticated', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`);
        assert.equal(res.status, 401);
    });

    it('should return 403 when authenticated as CLIENTE', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            headers: { Cookie: clientCookie }
        });
        assert.equal(res.status, 403);
    });

    it('should list all products for ADMIN', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            headers: { Cookie: adminCookie }
        });
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(Array.isArray(body), true);
    });

    it('should return 400 on invalid product creation data, missing body, or fields exceeding max length', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: '',
                nombre: 'Producto Inválido',
                precio: -50,
                stock: -1
            })
        });
        assert.equal(res.status, 400);

        const emptyPostRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            }
        });
        assert.equal(emptyPostRes.status, 400);

        const emptyPutRes = await fetch(`${BASE_URL}/admin/productos/1`, {
            method: 'PUT',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            }
        });
        assert.equal(emptyPutRes.status, 400);

        const tooLongRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: 'A'.repeat(101),
                nombre: 'B'.repeat(201),
                precio: 100,
                stock: 10
            })
        });
        assert.equal(tooLongRes.status, 400);
    });

    it('should create and update a product as ADMIN', async () => {
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: `${TEST_PREFIX}1`,
                nombre: 'Taladro Test 197',
                precio: 1500.50,
                stock: 10,
                activo: true
            })
        });

        const createdBody = await createRes.json();
        if (createdBody && createdBody.id_producto) {
            createdProductIds.push(createdBody.id_producto);
        }
        assert.equal(createRes.status, 201, `Fallo creacion: ${createdBody.message || ''}`);
        const createdId = createdBody.id_producto;

        const updateRes = await fetch(`${BASE_URL}/admin/productos/${createdId}`, {
            method: 'PUT',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nombre: 'Taladro Test 197 Editado',
                precio: 1800.00
            })
        });

        assert.equal(updateRes.status, 200, 'Fallo la actualizacion del producto');
        const updatedBody = await updateRes.json();
        assert.equal(updatedBody.nombre, 'Taladro Test 197 Editado');
    });

    it('should soft-delete (deactivate) a product idempotently', async () => {
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: `${TEST_PREFIX}DEACT`,
                nombre: 'Producto a desactivar',
                precio: 100,
                stock: 5,
                activo: true
            })
        });
        const createdBody = await createRes.json();
        if (createdBody && createdBody.id_producto) {
            createdProductIds.push(createdBody.id_producto);
        }
        assert.equal(createRes.status, 201, `Fallo creacion: ${createdBody.message || ''}`);
        const createdId = createdBody.id_producto;

        const deactRes1 = await fetch(`${BASE_URL}/admin/productos/${createdId}/desactivar`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie }
        });
        assert.equal(deactRes1.status, 200, 'Fallo la primera desactivacion');

        const body1 = await deactRes1.json();
        assert.equal(Boolean(body1.product.activo), false, 'El producto sigue activo');

        const deactRes2 = await fetch(`${BASE_URL}/admin/productos/${createdId}/desactivar`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie }
        });
        assert.equal(deactRes2.status, 200, 'Fallo la idempotencia');
    });

    it('should update product stock successfully', async () => {
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: `${TEST_PREFIX}STOCK`,
                nombre: 'Producto para Stock',
                precio: 100,
                stock: 5,
                activo: true
            })
        });
        const createdBody = await createRes.json();
        if (createdBody && createdBody.id_producto) {
            createdProductIds.push(createdBody.id_producto);
        }
        assert.equal(createRes.status, 201, `Fallo creacion: ${createdBody.message || ''}`);
        const createdId = createdBody.id_producto;

        const updateRes = await fetch(`${BASE_URL}/admin/productos/${createdId}/stock`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: 25 })
        });

        assert.equal(updateRes.status, 200, 'Fallo la actualización de stock');
        const body = await updateRes.json();
        assert.equal(body.product.stock, 25);
    });

    it('should return 400 when updating with negative stock', async () => {
        const updateRes = await fetch(`${BASE_URL}/admin/productos/1/stock`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: -10 })
        });

        assert.equal(updateRes.status, 400);
    });

    it('should return 400 when updating stock with invalid data types or out of range', async () => {
        const invalidStocks = [
            true,
            false,
            null,
            [5],
            '10',
            3000000000
        ];

        for (const badStock of invalidStocks) {
            const res = await fetch(`${BASE_URL}/admin/productos/1/stock`, {
                method: 'PATCH',
                headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
                body: JSON.stringify({ stock: badStock })
            });
            assert.equal(res.status, 400, `Falló validando el valor: ${JSON.stringify(badStock)}`);
        }
    });

    it('should return 400 when updating stock without a body', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos/1/stock`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }
        });
        assert.equal(res.status, 400);
    });

    it('should return persisted price precision (1.24 for 1.239) in fallback when post-INSERT SELECT fails', async (t) => {
        const repo = require('../dist/repositories/adminProduct.repository.js');
        const { createAdminProduct } = require('../dist/services/adminProduct.service.js');

        // Simulamos fallo del SELECT posterior al INSERT
        t.mock.method(repo, 'findById', async () => {
            throw new Error('Fallo simulado de lectura post-INSERT');
        });

        const fallbackResult = await createAdminProduct({
            id_categoria: 1,
            codigo: `${TEST_PREFIX}FALLBACK-PRICE`,
            nombre: 'Producto Fallback Decimal',
            precio: 1.239,
            stock: 4,
            activo: true
        });

        t.mock.restoreAll();

        if (fallbackResult && fallbackResult.id_producto) {
            createdProductIds.push(fallbackResult.id_producto);
        }

        const persistedRow = await repo.findById(fallbackResult.id_producto);
        assert.ok(persistedRow, 'El producto debe existir en MariaDB');
        assert.equal(Number(persistedRow.precio), 1.24);
        assert.equal(Number(fallbackResult.precio), Number(persistedRow.precio));
        assert.equal(fallbackResult.precio, persistedRow.precio);
    });

    it('migration should trim leading and trailing spaces in SKU, validate UNIQUE index definition, and be idempotent', async () => {
        const { pool } = require('../dist/config/database.config.js');
        const baseLeadSku = `${TEST_PREFIX}MIG-LEAD`;
        const baseTrailSku = `${TEST_PREFIX}MIG-TRAIL`;
        const baseBothSku = `${TEST_PREFIX}MIG-BOTH`;

        // Insertamos directamente en SQL con espacios iniciales, finales y ambos
        const resLead = await pool.query(
            'INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, ?, 10.00, 1, 1)',
            [`   ${baseLeadSku}`, 'Test Leading Spaces']
        );
        createdProductIds.push(Number(resLead.insertId));

        const resTrail = await pool.query(
            'INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, ?, 10.00, 1, 1)',
            [`${baseTrailSku}    `, 'Test Trailing Spaces']
        );
        createdProductIds.push(Number(resTrail.insertId));

        const resBoth = await pool.query(
            'INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, ?, 10.00, 1, 1)',
            [`  ${baseBothSku}   `, 'Test Both Spaces']
        );
        createdProductIds.push(Number(resBoth.insertId));

        // Ejecutamos la migración 2 veces seguidas (prueba de idempotencia)
        await runMigrationSql(pool);
        await runMigrationSql(pool);

        const rows = await pool.query(
            'SELECT id_producto, codigo, CHAR_LENGTH(codigo) AS len FROM PRODUCTO WHERE id_producto IN (?, ?, ?)',
            [Number(resLead.insertId), Number(resTrail.insertId), Number(resBoth.insertId)]
        );

        const byId = new Map(rows.map((r) => [r.id_producto, r]));
        assert.equal(byId.get(Number(resLead.insertId)).codigo, baseLeadSku);
        assert.equal(Number(byId.get(Number(resLead.insertId)).len), baseLeadSku.length);

        assert.equal(byId.get(Number(resTrail.insertId)).codigo, baseTrailSku);
        assert.equal(Number(byId.get(Number(resTrail.insertId)).len), baseTrailSku.length);

        assert.equal(byId.get(Number(resBoth.insertId)).codigo, baseBothSku);
        assert.equal(Number(byId.get(Number(resBoth.insertId)).len), baseBothSku.length);

        // Verificamos que si el índice uq_producto_codigo es reemplazado por un índice NO-UNIQUE, la migración lo corrige
        await pool.query('ALTER TABLE PRODUCTO DROP INDEX uq_producto_codigo');
        await pool.query('ALTER TABLE PRODUCTO ADD INDEX uq_producto_codigo (codigo)');

        await runMigrationSql(pool);

        const indexStats = await pool.query(
            `SELECT NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX, SUB_PART
                FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'PRODUCTO'
                    AND INDEX_NAME = 'uq_producto_codigo'`
        );
        assert.equal(indexStats.length, 1);
        assert.equal(Number(indexStats[0].NON_UNIQUE), 0);
        assert.equal(indexStats[0].COLUMN_NAME, 'codigo');
    });

    // Limpiar la BD exclusivamente por los IDs creados y cerrar conexión siempre
    after(async () => {
        const { pool } = require('../dist/config/database.config.js');
        if (pool) {
            try {
                if (createdProductIds.length > 0) {
                    const placeholders = createdProductIds.map(() => '?').join(', ');
                    await pool.query(
                        `DELETE FROM PRODUCTO WHERE id_producto IN (${placeholders})`,
                        createdProductIds
                    );
                }
            } finally {
                await pool.end();
            }
        }
    });
});