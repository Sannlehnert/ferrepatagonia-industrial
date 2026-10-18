require('dotenv/config'); // Carga tu .env automáticamente
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const BASE_URL = 'http://localhost:3000/api';

describe('Admin Products Endpoints (#197)', () => {
    let adminCookie = '';
    let clientCookie = '';

    before(() => {
        // 1. Obtenemos el secreto real de tu .env
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error("No se encontró JWT_SECRET en el entorno.");

        // 2. Forjamos el token de ADMIN directamente (ID 4 según tu esquema)
        // ¡Adiós a depender de contraseñas de la base de datos!
        const adminToken = jwt.sign({ id: 4, rol: 'ADMIN' }, secret, { expiresIn: '2h' });
        adminCookie = `jwt_token=${adminToken}`;

        // 3. Forjamos el token de CLIENTE (ID 1)
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
        // 1. Crear producto
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { 
                'Cookie': adminCookie,
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                id_categoria: 1, 
                codigo: `TEST-SKU-${Date.now()}`, 
                nombre: 'Taladro Test 197',
                precio: 1500.50,
                stock: 10,
                activo: true
            })
        });
        
        const createdBody = await createRes.json();
        assert.equal(createRes.status, 201, `Fallo creacion: ${createdBody.message || ''}`);
        const createdId = createdBody.id_producto;

        // 2. Editar producto
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
        // 1. Crear producto temporal para la prueba
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_categoria: 1, 
                codigo: `TEST-SKU-DEACT-${Date.now()}`,
                nombre: 'Producto a desactivar',
                precio: 100,
                stock: 5,
                activo: true
            })
        });
        const createdId = (await createRes.json()).id_producto;

        // 2. Desactivarlo por primera vez
        const deactRes1 = await fetch(`${BASE_URL}/admin/productos/${createdId}/desactivar`, {
            method: 'PATCH',
            headers: { 'Cookie': adminCookie }
        });
        assert.equal(deactRes1.status, 200, 'Fallo la primera desactivacion');
        
        const body1 = await deactRes1.json();
        // Dependiendo del driver, MariaDB devuelve 0 o false para el TINYINT(1)
        assert.equal(Boolean(body1.product.activo), false, 'El producto sigue activo'); 

        // 3. Desactivarlo de nuevo (Prueba de Idempotencia)
        const deactRes2 = await fetch(`${BASE_URL}/admin/productos/${createdId}/desactivar`, {
            method: 'PATCH',
            headers: { 'Cookie': adminCookie }
        });
        assert.equal(deactRes2.status, 200, 'Fallo la idempotencia');
    });
});