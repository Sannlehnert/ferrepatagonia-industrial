const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Variables de entorno para ejecución de tests aislados
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-fer17-min-32-chars-long';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3307';
process.env.DB_NAME = process.env.DB_NAME || 'ferrepatagonia_dev';
process.env.DB_USER = process.env.DB_USER || 'ferrepatagonia';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'ferrepatagonia_dev_only';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { dataSource, destroyDatabase } = require('../dist/config/database.config.js');
const {
    ListaPrecioSchema,
    ProductoSchema,
    ClienteSchema,
    CotizacionSchema,
    CategoriaSchema,
} = require('../dist/entities/active.schemas.js');

describe('S5-17.2 (#240) — Modelo de datos e integridad FER-15/FER-17', async () => {
    const RUN_ID = Date.now();
    const TEST_DATE = '2099-11-02';
    let testListaId = null;
    let testClienteId = null;
    let testProductoId = null;
    let testCotizacionId = null;
    let categoriaId = 1;

    before(async () => {
        if (!dataSource.isInitialized) {
            await dataSource.initialize();
        }
        const catRepo = dataSource.getRepository(CategoriaSchema);
        const existingCat = await catRepo.findOne({ where: { activo: 1 } });
        if (existingCat) {
            categoriaId = existingCat.id_categoria;
        }

        // Limpieza preventiva ante ejecuciones previas interrumpidas
        await dataSource.getRepository(CotizacionSchema).delete({ fecha_referencia: TEST_DATE }).catch(() => {});
    });

    after(async () => {
        try {
            if (testClienteId) {
                await dataSource.getRepository(ClienteSchema).delete(testClienteId);
            }
            if (testListaId) {
                await dataSource.getRepository(ListaPrecioSchema).delete(testListaId);
            }
            if (testProductoId) {
                await dataSource.getRepository(ProductoSchema).delete(testProductoId);
            }
            if (testCotizacionId) {
                await dataSource.getRepository(CotizacionSchema).delete(testCotizacionId);
            }
        } finally {
            await destroyDatabase();
        }
    });

    // 1. LISTA_PRECIO: Validaciones y límites (D01, D03, D07)
    test('D03/D07: Rechaza lista con descuento negativo o >= 100.00%', async () => {
        const repo = dataSource.getRepository(ListaPrecioSchema);

        await assert.rejects(
            repo.insert({ nombre: 'Desc 100%', porcentaje_descuento: '100.00', activa: 1 }),
            /chk_lista_precio_porcentaje/i
        );

        await assert.rejects(
            repo.insert({ nombre: 'Desc Negativo', porcentaje_descuento: '-5.00', activa: 1 }),
            /chk_lista_precio_porcentaje/i
        );
    });

    test('D01: Permite crear lista con porcentaje válido dentro de 0.00 y 99.99%', async () => {
        const repo = dataSource.getRepository(ListaPrecioSchema);
        const res = await repo.insert({
            nombre: `Lista Gremio ${RUN_ID}`,
            porcentaje_descuento: '15.50',
            activa: 1,
        });
        testListaId = res.identifiers[0].id_lista_precio;
        assert.ok(testListaId > 0);

        const saved = await repo.findOneBy({ id_lista_precio: testListaId });
        assert.equal(saved.nombre, `Lista Gremio ${RUN_ID}`);
        assert.equal(Number(saved.porcentaje_descuento), 15.5);
        assert.equal(saved.activa, 1);
    });

    // 2. PRODUCTO: Descuento especial público (D07, D10)
    test('D07/D10: Rechaza descuento especial público >= 100.00% en producto', async () => {
        const repo = dataSource.getRepository(ProductoSchema);

        await assert.rejects(
            repo.insert({
                id_categoria: categoriaId,
                codigo: `TEST-SKU-FER17-INV-${RUN_ID}`,
                nombre: 'Prod Invalido',
                precio: '100.00',
                descuento_especial_pct: '100.00',
                stock: 5,
                activo: 1,
            }),
            /chk_producto_descuento/i
        );
    });

    test('D10: Permite producto con descuento especial opcional válido', async () => {
        const repo = dataSource.getRepository(ProductoSchema);
        const res = await repo.insert({
            id_categoria: categoriaId,
            codigo: `TEST-SKU-FER17-VAL-${RUN_ID}`,
            nombre: 'Prod Promo Test',
            precio: '150.00',
            descuento_especial_pct: '12.50',
            stock: 10,
            activo: 1,
        });
        testProductoId = res.identifiers[0].id_producto;
        assert.ok(testProductoId > 0);

        const saved = await repo.findOneBy({ id_producto: testProductoId });
        assert.equal(saved.precio, '150.00');
        assert.equal(Number(saved.descuento_especial_pct), 12.5);
    });

    // 3. CLIENTE: Asociación opcional e integridad referencial RESTRICT (D01, D04)
    test('D01: Permite cliente con lista asignada y valida FK', async () => {
        const repo = dataSource.getRepository(ClienteSchema);
        const res = await repo.insert({
            id_lista_precio: testListaId,
            tipo_cliente: 'PARTICULAR',
            nombre_razon_social: `Cliente Test ${RUN_ID}`,
            es_fiel: 0,
            activo: 1,
        });
        testClienteId = res.identifiers[0].id_cliente;
        assert.ok(testClienteId > 0);

        const saved = await repo.findOneBy({ id_cliente: testClienteId });
        assert.equal(saved.id_lista_precio, testListaId);
    });

    test('Integridad: Rechaza borrar lista de precios referenciada por un cliente (RESTRICT)', async () => {
        const listaRepo = dataSource.getRepository(ListaPrecioSchema);

        await assert.rejects(
            listaRepo.delete(testListaId),
            /fk_cliente_lista_precio|foreign key constraint fails/i
        );
    });

    // 4. COTIZACION: Calendario manual y precisión DECIMAL(20,8) (D06, D07)
    test('D07: Rechaza cotización con tasa menor o igual a cero', async () => {
        const repo = dataSource.getRepository(CotizacionSchema);

        await assert.rejects(
            repo.insert({
                tasa: '0.00000000',
                fecha_referencia: TEST_DATE,
                actor: 'admin@ferrepatagonia.test',
                valida: 1,
            }),
            /chk_cotizacion_tasa/i
        );
    });

    test('D06/D07: Registra tasa con 8 decimales y rechaza fecha duplicada (UQ)', async () => {
        const repo = dataSource.getRepository(CotizacionSchema);
        const res = await repo.insert({
            tasa: '1234.56789012',
            fecha_referencia: TEST_DATE,
            actor: 'admin@ferrepatagonia.test',
            valida: 1,
        });
        testCotizacionId = res.identifiers[0].id_cotizacion;
        assert.ok(testCotizacionId > 0);

        const saved = await repo.findOneBy({ id_cotizacion: testCotizacionId });
        assert.equal(saved.tasa, '1234.56789012');

        await assert.rejects(
            repo.insert({
                tasa: '1250.00000000',
                fecha_referencia: TEST_DATE,
                actor: 'admin@ferrepatagonia.test',
                valida: 1,
            }),
            /uq_cotizacion_fecha|duplicate entry/i
        );
    });

    // 5. Preservación histórica
    test('No pérdida de datos: Registros previos conservan precio y tienen nuevos campos null', async () => {
        const prodRepo = dataSource.getRepository(ProductoSchema);
        const prods = await prodRepo.find({ take: 5 });
        for (const p of prods) {
            assert.ok(p.id_producto > 0);
            assert.ok(p.precio !== undefined);
            if (p.id_producto !== testProductoId) {
                assert.equal(p.descuento_especial_pct, null);
            }
        }
    });
});