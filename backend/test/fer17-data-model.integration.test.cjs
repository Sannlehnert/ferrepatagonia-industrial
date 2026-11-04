require('./helpers/integration-lifecycle.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mariadb = require('mariadb');
const { dataSource } = require('../dist/config/database.config.js');
const { pool } = require('../dist/config/catalog-snapshot.config.js');
after(() => pool.end());

const {
    ListaPrecioSchema,
    ProductoSchema,
    ClienteSchema,
    CotizacionSchema,
    CategoriaSchema,
} = require('../dist/entities/active.schemas.js');

const MIGRATION_PATH = path.resolve(__dirname, '../../database/migrate-fer-17-price-lists.sql');

function extractExecutableMigrationSql() {
    const raw = fs.readFileSync(MIGRATION_PATH, 'utf8');
    return raw
        .replace(/^SET NAMES\s+\S+;\s*$/gim, '')
        .replace(/^DELIMITER\s+\S+\s*$/gim, '')
        .replace(/END\s*\/\//g, 'END;')
        .trim();
}

const LEGACY_PRE_FER17_DDL = [
    `CREATE TABLE CATEGORIA (
        id_categoria INT NOT NULL AUTO_INCREMENT,
        nombre VARCHAR(150) NOT NULL,
        descripcion TEXT NULL,
        activo BOOLEAN NOT NULL,
        PRIMARY KEY (id_categoria),
        CONSTRAINT chk_categoria_activo CHECK (activo IN (0, 1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE PRODUCTO (
        id_producto INT NOT NULL AUTO_INCREMENT,
        id_categoria INT NOT NULL,
        codigo VARCHAR(100) NOT NULL,
        nombre VARCHAR(200) NOT NULL,
        descripcion TEXT NULL,
        precio DECIMAL(12,2) NOT NULL,
        stock INT NOT NULL,
        imagen VARCHAR(2048) NULL,
        activo BOOLEAN NOT NULL,
        fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id_producto),
        UNIQUE KEY uq_producto_codigo (codigo),
        KEY idx_producto_categoria (id_categoria),
        CONSTRAINT fk_producto_categoria FOREIGN KEY (id_categoria)
            REFERENCES CATEGORIA (id_categoria) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT chk_producto_precio CHECK (precio >= 0),
        CONSTRAINT chk_producto_stock CHECK (stock >= 0),
        CONSTRAINT chk_producto_activo CHECK (activo IN (0, 1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE CLIENTE (
        id_cliente INT NOT NULL AUTO_INCREMENT,
        tipo_cliente VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
        nombre_razon_social VARCHAR(200) NOT NULL,
        doc_cliente VARCHAR(30) NULL,
        cuit VARCHAR(20) NULL,
        email VARCHAR(254) NULL,
        telefono VARCHAR(50) NULL,
        direccion VARCHAR(500) NULL,
        estado_aprobacion_empresa VARCHAR(20) COLLATE utf8mb4_bin NULL,
        es_fiel BOOLEAN NOT NULL,
        activo BOOLEAN NOT NULL,
        fecha_alta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id_cliente),
        CONSTRAINT chk_cliente_tipo CHECK (tipo_cliente IN ('PARTICULAR', 'EMPRESA')),
        CONSTRAINT chk_cliente_estado_empresa CHECK (
            estado_aprobacion_empresa IS NULL
            OR estado_aprobacion_empresa IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')
        ),
        CONSTRAINT chk_cliente_aprobacion_tipo CHECK (
            (tipo_cliente = 'PARTICULAR' AND estado_aprobacion_empresa IS NULL)
            OR (tipo_cliente = 'EMPRESA' AND estado_aprobacion_empresa IS NOT NULL)
        ),
        CONSTRAINT chk_cliente_fiel CHECK (es_fiel IN (0, 1)),
        CONSTRAINT chk_cliente_activo CHECK (activo IN (0, 1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

describe('S5-17.2 (#240) — Modelo de datos, migración e integridad FER-15/FER-17', () => {
    const RUN_ID = randomUUID().slice(0, 12);
    let testDate = null;
    let testListaId = null;
    let testClienteId = null;
    const createdProductoIds = [];
    let testCotizacionId = null;
    let categoriaId = null;
    let createdCategoriaId = null;

    before(async () => {
        const catRepo = dataSource.getRepository(CategoriaSchema);
        const existingCat = await catRepo.findOne({ where: { activo: 1 } });
        if (existingCat) {
            categoriaId = existingCat.id_categoria;
        } else {
            const catRes = await catRepo.insert({
                nombre: `Cat Test FER17 ${RUN_ID}`,
                descripcion: 'Categoría temporal de prueba',
                activo: 1,
            });
            createdCategoriaId = catRes.identifiers[0].id_categoria;
            categoriaId = createdCategoriaId;
        }

        // H01: Seleccionar una fecha libre sin borrar nunca cotizaciones preexistentes
        const cotRepo = dataSource.getRepository(CotizacionSchema);
        let offset = 1;
        while (!testDate) {
            const candidate = new Date(Date.UTC(2120, 0, offset)).toISOString().slice(0, 10);
            const existing = await cotRepo.findOne({ where: { fecha_referencia: candidate } });
            if (!existing) {
                testDate = candidate;
            }
            offset += 1;
        }
    });

    after(async () => {
        if (testClienteId) {
            await dataSource.getRepository(ClienteSchema).delete(testClienteId);
        }
        if (testListaId) {
            await dataSource.getRepository(ListaPrecioSchema).delete(testListaId);
        }
        if (createdProductoIds.length > 0) {
            await dataSource.getRepository(ProductoSchema).delete(createdProductoIds);
        }
        if (testCotizacionId) {
            await dataSource.getRepository(CotizacionSchema).delete(testCotizacionId);
        }
        if (createdCategoriaId) {
            await dataSource.getRepository(CategoriaSchema).delete(createdCategoriaId);
        }
    });

    // 1. LISTA_PRECIO: Validaciones y límites (D01, D03, D07)
    test('D03/D07: Rechaza lista con descuento negativo o >= 100.00%', async () => {
        const repo = dataSource.getRepository(ListaPrecioSchema);

        await assert.rejects(
            repo.insert({ nombre: `Desc 100% ${RUN_ID}`, porcentaje_descuento: '100.00', activa: 1 }),
            /chk_lista_precio_porcentaje/i
        );

        await assert.rejects(
            repo.insert({ nombre: `Desc Negativo ${RUN_ID}`, porcentaje_descuento: '-5.00', activa: 1 }),
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

    // 2. PRODUCTO: Descuento especial público y ausencia de precio (D03, D07, D10)
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
        const prodId = res.identifiers[0].id_producto;
        createdProductoIds.push(prodId);
        assert.ok(prodId > 0);

        const saved = await repo.findOneBy({ id_producto: prodId });
        assert.equal(saved.precio, '150.00');
        assert.equal(Number(saved.descuento_especial_pct), 12.5);
    });

    test('D03 (H03): Representa explícitamente precio ausente (NULL), cero (0.00) y positivo, rechazando negativos', async () => {
        const repo = dataSource.getRepository(ProductoSchema);

        const resNull = await repo.insert({
            id_categoria: categoriaId,
            codigo: `TEST-SKU-FER17-NULL-${RUN_ID}`,
            nombre: 'Prod Sin Precio',
            precio: null,
            descuento_especial_pct: null,
            stock: 3,
            activo: 1,
        });
        const nullProdId = resNull.identifiers[0].id_producto;
        createdProductoIds.push(nullProdId);

        const savedNull = await repo.findOneBy({ id_producto: nullProdId });
        assert.equal(savedNull.precio, null);

        const resZero = await repo.insert({
            id_categoria: categoriaId,
            codigo: `TEST-SKU-FER17-ZERO-${RUN_ID}`,
            nombre: 'Prod Precio Cero',
            precio: '0.00',
            descuento_especial_pct: null,
            stock: 3,
            activo: 1,
        });
        const zeroProdId = resZero.identifiers[0].id_producto;
        createdProductoIds.push(zeroProdId);

        const savedZero = await repo.findOneBy({ id_producto: zeroProdId });
        assert.equal(savedZero.precio, '0.00');
        assert.notEqual(savedZero.precio, savedNull.precio);

        await assert.rejects(
            repo.insert({
                id_categoria: categoriaId,
                codigo: `TEST-SKU-FER17-NEG-${RUN_ID}`,
                nombre: 'Prod Precio Negativo',
                precio: '-1.00',
                descuento_especial_pct: null,
                stock: 1,
                activo: 1,
            }),
            /chk_producto_precio/i
        );
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

    // 4. COTIZACION: Calendario manual, precisión DECIMAL(20,8) y preservación de fixtures previos (H01, D06, D07)
    test('D07: Rechaza cotización con tasa menor o igual a cero', async () => {
        const repo = dataSource.getRepository(CotizacionSchema);

        await assert.rejects(
            repo.insert({
                tasa: '0.00000000',
                fecha_referencia: testDate,
                actor: 'admin@ferrepatagonia.test',
                valida: 1,
            }),
            /chk_cotizacion_tasa/i
        );
    });

    test('D06/D07/H01: Registra tasa con 8 decimales, rechaza duplicados y conserva cotizaciones preexistentes', async () => {
        const repo = dataSource.getRepository(CotizacionSchema);

        // Insertar un centinela previo en 2099-11-02 (si no existe) y verificar que la suite jamás lo borra
        const sentinelDate = '2099-11-02';
        let createdSentinelId = null;
        const preExisting = await repo.findOne({ where: { fecha_referencia: sentinelDate } });
        if (!preExisting) {
            const sentinelRes = await repo.insert({
                tasa: '999.11111111',
                fecha_referencia: sentinelDate,
                actor: 'AUDIT_PREEXISTING_SENTINEL',
                valida: 1,
            });
            createdSentinelId = sentinelRes.identifiers[0].id_cotizacion;
        }

        try {
            const res = await repo.insert({
                tasa: '1234.56789012',
                fecha_referencia: testDate,
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
                    fecha_referencia: testDate,
                    actor: 'admin@ferrepatagonia.test',
                    valida: 1,
                }),
                /uq_cotizacion_fecha|duplicate entry/i
            );

            const sentinelAfter = await repo.findOne({ where: { fecha_referencia: sentinelDate } });
            assert.ok(sentinelAfter, 'La cotización preexistente en 2099-11-02 debe conservarse intacta');
        } finally {
            if (createdSentinelId) {
                await repo.delete(createdSentinelId);
            }
        }
    });

    // 5. Migración real desde esquema previo, preservación de 173.12, D03 post-upgrade y repetición (H02, H03)
    test('Migración compatible (H02/H03): Upgrade desde esquema previo conserva 173.12, habilita precio NULL y es idempotente', async () => {
        const migDb = `fer17_mig_full_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const conn = await mariadb.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            multipleStatements: true,
        });

        try {
            await conn.query(`CREATE DATABASE ${migDb} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
            await conn.query(`USE ${migDb}`);

            for (const ddl of LEGACY_PRE_FER17_DDL) {
                await conn.query(ddl);
            }

            const catInsert = await conn.query(
                "INSERT INTO CATEGORIA (nombre, descripcion, activo) VALUES ('Cat Histórica', NULL, 1)"
            );
            const prodInsert = await conn.query(
                "INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (?, 'HIST-173', 'Prod Histórico', 173.12, 8, 1)",
                [Number(catInsert.insertId)]
            );
            const histProdId = Number(prodInsert.insertId);

            // Antes de migrar, precio NULL es rechazado por NOT NULL
            await assert.rejects(
                conn.query('UPDATE PRODUCTO SET precio = NULL WHERE id_producto = ?', [histProdId]),
                /cannot be null|ER_BAD_NULL_ERROR/i
            );

            const migrationSql = extractExecutableMigrationSql();
            await conn.query('SET NAMES utf8mb4');
            await conn.query(migrationSql);
            // Segunda ejecución para demostrar idempotencia
            await conn.query(migrationSql);

            const [migratedProd] = await conn.query(
                'SELECT precio, descuento_especial_pct FROM PRODUCTO WHERE id_producto = ?',
                [histProdId]
            );
            assert.equal(String(migratedProd.precio), '173.12');
            assert.equal(migratedProd.descuento_especial_pct, null);

            // H03 post-migración: ahora permite actualizar a NULL
            await conn.query('UPDATE PRODUCTO SET precio = NULL WHERE id_producto = ?', [histProdId]);
            const [nullProd] = await conn.query(
                'SELECT precio FROM PRODUCTO WHERE id_producto = ?',
                [histProdId]
            );
            assert.equal(nullProd.precio, null);
        } finally {
            await conn.query(`DROP DATABASE IF EXISTS ${migDb}`);
            await conn.end();
        }
    });

    // 6. Recuperación desde estado DDL parcial (Regresión H04)
    test('Recuperación de migración parcial (H04): Reintento agrega CHECK y FK faltantes cuando las columnas ya existían', async () => {
        const partialDb = `fer17_mig_part_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const conn = await mariadb.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            multipleStatements: true,
        });

        try {
            await conn.query(`CREATE DATABASE ${partialDb} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
            await conn.query(`USE ${partialDb}`);

            for (const ddl of LEGACY_PRE_FER17_DDL) {
                await conn.query(ddl);
            }

            const catInsert = await conn.query(
                "INSERT INTO CATEGORIA (nombre, descripcion, activo) VALUES ('Cat Parcial', NULL, 1)"
            );
            const prodInsert = await conn.query(
                "INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (?, 'PART-001', 'Prod Parcial', 50.00, 4, 1)",
                [Number(catInsert.insertId)]
            );
            const prodId = Number(prodInsert.insertId);

            // Simular estado parcial H04: columnas agregadas sin sus restricciones CHECK ni FK
            await conn.query('ALTER TABLE PRODUCTO ADD COLUMN descuento_especial_pct DECIMAL(5,2) NULL');
            await conn.query('ALTER TABLE CLIENTE ADD COLUMN id_lista_precio INT NULL');

            const migrationSql = extractExecutableMigrationSql();
            await conn.query('SET NAMES utf8mb4');
            await conn.query(migrationSql);
            await conn.query(migrationSql);

            const constraints = await conn.query(
                `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
                 FROM information_schema.TABLE_CONSTRAINTS
                 WHERE CONSTRAINT_SCHEMA = ?
                   AND CONSTRAINT_NAME IN ('chk_producto_descuento', 'fk_cliente_lista_precio')`,
                [partialDb]
            );
            const names = constraints.map(c => c.CONSTRAINT_NAME).sort();
            assert.deepEqual(names, ['chk_producto_descuento', 'fk_cliente_lista_precio']);

            // Verificar que las restricciones recuperadas bloquean datos inválidos
            await assert.rejects(
                conn.query('UPDATE PRODUCTO SET descuento_especial_pct = 100.00 WHERE id_producto = ?', [prodId]),
                /chk_producto_descuento/i
            );

            await assert.rejects(
                conn.query(
                    "INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, es_fiel, activo, id_lista_precio) VALUES ('PARTICULAR', 'Cliente FK Invalida', 0, 1, 99999)"
                ),
                /fk_cliente_lista_precio|foreign key constraint fails/i
            );
        } finally {
            await conn.query(`DROP DATABASE IF EXISTS ${partialDb}`);
            await conn.end();
        }
    });
});