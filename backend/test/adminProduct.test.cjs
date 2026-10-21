require('dotenv/config'); // Carga el .env automáticamente
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const RUN_ID = Date.now();
const TEST_PREFIX = `TEST-RUN-${RUN_ID}-SKU-`;

const BASE_URL = 'http://localhost:3000/api';

describe('Admin Products Endpoints (#197)', () => {
    let adminCookie = '';
    let clientCookie = '';

    before(() => {
        // Obtenemos el secreto real del .env
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error("No se encontró JWT_SECRET en el entorno.");

        // Forjamos el token de ADMIN directamente
        const adminToken = jwt.sign({ id: 4, rol: 'ADMIN' }, secret, { expiresIn: '2h' });
        adminCookie = `jwt_token=${adminToken}`;

        // Forjamos el token de CLIENTE (ID 1)
        const clientToken = jwt.sign({ id: 1, rol: 'CLIENTE' }, secret, { expiresIn: '2h' });
        clientCookie = `jwt_token=${clientToken}`;
    });

    it('should return 401 when unauthenticated', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`);
        assert.equal(res.status, 401);
    });

    it('should return 403 when authenticated as CLIENTE', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            headers: { 'Cookie': clientCookie }
        });
        assert.equal(res.status, 403);
    });

    it('should list all products for ADMIN', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            headers: { 'Cookie': adminCookie }
        });
        assert.equal(res.status, 200);
        
        const body = await res.json();
        assert.equal(Array.isArray(body), true);
    });

    it('should return 400 on invalid product creation data', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { 
                'Cookie': adminCookie,
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
    });

    it('should create and update a product as ADMIN', async () => {
        // Crear producto
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { 
                'Cookie': adminCookie,
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
        assert.equal(createRes.status, 201, `Fallo creacion: ${createdBody.message || ''}`);
        const createdId = createdBody.id_producto;

        // Editar producto
        const updateRes = await fetch(`${BASE_URL}/admin/productos/${createdId}`, {
            method: 'PUT',
            headers: { 
                'Cookie': adminCookie,
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
        // Crear producto temporal para la prueba
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_categoria: 1, 
                codigo: `${TEST_PREFIX}DEACT`,
                nombre: 'Producto a desactivar',
                precio: 100,
                stock: 5,
                activo: true
            })
        });
        const createdId = (await createRes.json()).id_producto;

        // Desactivarlo por primera vez
        const deactRes1 = await fetch(`${BASE_URL}/admin/productos/${createdId}/desactivar`, {
            method: 'PATCH',
            headers: { 'Cookie': adminCookie }
        });
        assert.equal(deactRes1.status, 200, 'Fallo la primera desactivacion');
        
        const body1 = await deactRes1.json();
        assert.equal(Boolean(body1.product.activo), false, 'El producto sigue activo'); 

        // Desactivarlo de nuevo (Prueba de Idempotencia)
        const deactRes2 = await fetch(`${BASE_URL}/admin/productos/${createdId}/desactivar`, {
            method: 'PATCH',
            headers: { 'Cookie': adminCookie }
        });
        assert.equal(deactRes2.status, 200, 'Fallo la idempotencia');
    });

    it('should update product stock successfully', async () => {
        // Creamos un producto temporal
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_categoria: 1, 
                codigo: `${TEST_PREFIX}STOCK`,
                nombre: 'Producto para Stock',
                precio: 100,
                stock: 5,
                activo: true
            })
        });
        const createdId = (await createRes.json()).id_producto;

        // Le cambiamos el stock de 5 a 25
        const updateRes = await fetch(`${BASE_URL}/admin/productos/${createdId}/stock`, {
            method: 'PATCH',
            headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: 25 })
        });
        
        assert.equal(updateRes.status, 200, 'Fallo la actualización de stock');
        const body = await updateRes.json();
        assert.equal(body.product.stock, 25);
    });

    it('should return 400 when updating with negative stock', async () => {
        // Usamos el ID 1
        const updateRes = await fetch(`${BASE_URL}/admin/productos/1/stock`, {
            method: 'PATCH',
            headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: -10 })
        });
        
        assert.equal(updateRes.status, 400);
    });

    it('should return 400 when updating stock with invalid data types or out of range', async () => {
        const invalidStocks = [
            true,          // booleano
            false,         // booleano
            null,          // nulo
            [5],           // array
            "10",          // string
            3000000000     // overflow INT MariaDB
        ];

        for (const badStock of invalidStocks) {
            const res = await fetch(`${BASE_URL}/admin/productos/1/stock`, {
                method: 'PATCH',
                headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' },
                body: JSON.stringify({ stock: badStock })
            });
            assert.equal(res.status, 400, `Falló validando el valor: ${JSON.stringify(badStock)}`);
        }
    });

    it('should return 400 when updating stock without a body', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos/1/stock`, {
            method: 'PATCH',
            headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' }
        });
        assert.equal(res.status, 400);
    });

    // Limpiar la BD y cerrar conexión
    after(async () => {
        const { pool } = require('../dist/config/database.config.js');
        if (pool) {
            await pool.query("DELETE FROM PRODUCTO WHERE codigo LIKE ?", [`${TEST_PREFIX}%`]);
            await pool.end();
        }
    });
});