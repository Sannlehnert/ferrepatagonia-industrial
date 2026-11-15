// Preparacion local de usuarios de prueba con contrasenas reales (Sprint 7, T-S7-01.2).
//
// Uso (desde backend/, con backend/.env presente):
//   node scripts/prepare-local-users.cjs           # inspeccion sin mutaciones
//   node scripts/prepare-local-users.cjs --apply   # aplica con confirmacion explicita
//
// Reglas de seguridad:
// - Solo NODE_ENV=development. Nunca test ni production.
// - Identifica la base antes de escribir: exige exactamente las 21 tablas del
//   esquema vigente y los 3 triggers FER-20. Con una base anterior (por ejemplo
//   14 tablas) aborta sin mutar nada.
// - Nunca actualiza ni borra filas existentes: si el email ya tiene USUARIO lo
//   omite y conserva su contrasena y estado.
// - No crea cuenta corriente, movimientos ni credito.
// - Las contrasenas se generan aleatorias por cuenta y se escriben unicamente
//   en un archivo privado FUERA del repositorio (~/.ferrepatagonia-local),
//   con permisos 0600 en POSIX. Nunca se imprimen en consola ni logs.
//
// No depende de E2E_ISOLATED, E2E_DEMO_CATALOG ni del lanzador demo286.

require('dotenv/config');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// Mismo costo que backend/src/services/password.service.ts.
const SALT_ROUNDS = 12;

const EXPECTED_TABLES = new Set([
    'CATEGORIA', 'PRODUCTO', 'LISTA_PRECIO', 'COTIZACION', 'CLIENTE', 'USUARIO',
    'PEDIDO', 'DETALLE_PEDIDO', 'CUENTA_CORRIENTE', 'PAGO',
    'MOVIMIENTO_CUENTA_CORRIENTE', 'IMPUTACION_MOVIMIENTO_CUENTA',
    'PRECIO_USD_EVIDENCIA', 'FER17_CALENDARIO', 'FER17_COTIZACION_VERIFICACION',
    'FER17_LISTA_INACTIVA_EVENTO', 'CARRITO', 'ITEM_CARRITO',
    'CONFIRMACION_PEDIDO_CC', 'DETALLE_PEDIDO_CC_PRECIO', 'COMPROBANTE_PAGO',
]);

const EXPECTED_TRIGGERS = new Set([
    'fer260_cuenta_revision', 'fer260_imputacion_insert', 'fer260_imputacion_update',
]);

// Emails fijos del bootstrap local; el dominio .test es ficticio.
// Distintos de los usuarios de seed.sql (example.test) para no tocarlos nunca.
const ACCOUNTS = [
    {
        key: 'admin', rol: 'ADMIN',
        email: 'admin.local@s7.test', nombre: 'Admin Local S7',
        cliente: null,
    },
    {
        key: 'particular', rol: 'CLIENTE',
        email: 'particular.local@s7.test', nombre: 'Particular Local S7',
        cliente: { tipo_cliente: 'PARTICULAR', estado: null },
    },
    {
        key: 'pendiente', rol: 'CLIENTE',
        email: 'pendiente.local@s7.test', nombre: 'Empresa Pendiente Local S7',
        cliente: { tipo_cliente: 'EMPRESA', estado: 'PENDIENTE' },
    },
    {
        key: 'aprobada', rol: 'CLIENTE',
        email: 'aprobada.local@s7.test', nombre: 'Empresa Aprobada Local S7',
        cliente: { tipo_cliente: 'EMPRESA', estado: 'APROBADA' },
    },
];

function fail(message) {
    console.error(`ERROR: ${message}`);
    process.exitCode = 1;
    return null;
}

async function identifyDatabase(connection) {
    const [[identity]] = await connection.query('SELECT DATABASE() AS base, VERSION() AS version');
    const [tables] = await connection.query(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
    );
    const [triggers] = await connection.query(
        'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()',
    );
    return {
        base: identity.base, version: identity.version,
        tables: new Set(tables.map(row => row.name)),
        triggers: new Set(triggers.map(row => row.name)),
    };
}

function verifySchema(identity) {
    if (identity.tables.size === EXPECTED_TABLES.size && [...EXPECTED_TABLES].every(t => identity.tables.has(t))) {
        return null;
    }
    const missing = [...EXPECTED_TABLES].filter(t => !identity.tables.has(t));
    const extra = [...identity.tables].filter(t => !EXPECTED_TABLES.has(t));
    if (missing.length > 0 && identity.tables.size <= 20) {
        return `La base "${identity.base}" no tiene el esquema vigente (${identity.tables.size} tablas; faltan ${missing.length}).`
            + ' Puede ser un volumen anterior a FER-17/18/19/20. No se modifico nada.'
            + ' Acordar con el equipo una actualizacion o sustitucion controlada antes de usar este script.';
    }
    return `La base "${identity.base}" no coincide con el esquema vigente.`
        + (missing.length ? ` Tablas faltantes: ${missing.join(', ')}.` : '')
        + (extra.length ? ` Tablas no reconocidas: ${extra.join(', ')}.` : '');
}

function verifyTriggers(identity) {
    const missing = [...EXPECTED_TRIGGERS].filter(t => !identity.triggers.has(t));
    if (missing.length === 0) return null;
    return `Faltan los triggers FER-20: ${missing.join(', ')}. Aplicar database/migrate-fer-20-account-movements.sql antes de continuar.`;
}

function credentialsPath(database) {
    const dir = process.env.FERREPATAGONIA_LOCAL_DIR
        || path.join(os.homedir(), '.ferrepatagonia-local');
    return { dir, file: path.join(dir, `test-users-${database}.json`) };
}

// Escritura privada de credenciales: fuera del repositorio, 0700/0600 en POSIX.
// Conserva las entradas existentes; solo agrega cuentas creadas en esta corrida.
function saveCredentials(database, host, port, created) {
    const { dir, file } = credentialsPath(database);
    let stored = { database, host, port, generated_at: new Date().toISOString(), accounts: {} };
    try {
        const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (previous && previous.database === database && previous.accounts) stored = previous;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    for (const account of created) {
        if (stored.accounts[account.key]) continue; // Nunca reemplazar una credencial previa.
        stored.accounts[account.key] = { email: account.email, password: account.password, creado: account.creadoEn };
    }
    stored.generated_at = new Date().toISOString();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
    if (process.platform !== 'win32') {
        fs.chmodSync(dir, 0o700);
        fs.chmodSync(file, 0o600);
    }
    return file;
}

function generatePassword() {
    // 20 caracteres URL-safe, muy por encima del minimo de 8 de la politica.
    return crypto.randomBytes(15).toString('base64url');
}

async function planAccount(connection, account) {
    const [users] = await connection.query(
        'SELECT id_usuario, rol, activo FROM USUARIO WHERE email = ? LIMIT 1', [account.email],
    );
    if (users.length > 0) {
        return { account, action: 'omitido', detail: `USUARIO ya existe (id ${users[0].id_usuario}, rol ${users[0].rol}, activo ${users[0].activo}); no se modifica.` };
    }
    const [clients] = await connection.query(
        'SELECT id_cliente FROM CLIENTE WHERE email = ? LIMIT 1', [account.email],
    );
    if (clients.length > 0) {
        return { account, action: 'bloqueado', detail: `Existe CLIENTE id ${clients[0].id_cliente} con ese email sin USUARIO; revisar manualmente antes de crear nada.` };
    }
    return { account, action: account.cliente ? 'crear CLIENTE + USUARIO' : 'crear USUARIO', detail: null };
}

async function main() {
    const apply = process.argv.slice(2).includes('--apply');
    if (process.argv.slice(2).some(a => a !== '--apply')) {
        return fail('Modo valido: sin argumentos (inspeccion) o --apply.');
    }
    if (process.env.NODE_ENV !== 'development') {
        return fail(`Este script solo opera en desarrollo explicito (NODE_ENV=development; actual: ${process.env.NODE_ENV ?? 'sin definir'}).`);
    }
    const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
    if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER || !DB_PASSWORD) {
        return fail('Faltan DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD. Ejecutar desde backend/ con backend/.env.');
    }

    const connection = await mysql.createConnection({
        host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD,
        database: DB_NAME, charset: 'utf8mb4', multipleStatements: false,
    });

    try {
        const identity = await identifyDatabase(connection);
        console.log(`Base: ${identity.base} (${identity.version}) en ${DB_HOST}:${DB_PORT}. Tablas: ${identity.tables.size}, triggers FER-20: ${identity.triggers.size}.`);
        const schemaError = verifySchema(identity) ?? verifyTriggers(identity);
        if (schemaError) return fail(schemaError);

        const plans = [];
        for (const account of ACCOUNTS) {
            const plan = await planAccount(connection, account);
            plans.push(plan);
            console.log(`- ${account.key} (${account.email}): ${plan.action}${plan.detail ? ` — ${plan.detail}` : ''}`);
        }
        const toCreate = plans.filter(p => p.action !== 'omitido' && p.action !== 'bloqueado');
        if (!apply) {
            console.log(toCreate.length
                ? `Inspeccion sin mutaciones. ${toCreate.length} cuenta(s) se crearian con "node scripts/prepare-local-users.cjs --apply".`
                : 'Inspeccion sin mutaciones. No hay cuentas por crear.');
            return;
        }
        if (plans.some(p => p.action === 'bloqueado')) {
            return fail('Hay cuentas bloqueadas; resolver la situacion manualmente antes de aplicar.');
        }
        if (toCreate.length === 0) {
            console.log('Nada por crear: reejecucion segura, no se duplico ni modifico ninguna cuenta.');
            return;
        }

        await connection.beginTransaction();
        const created = [];
        try {
            for (const { account } of toCreate) {
                let clientId = null;
                if (account.cliente) {
                    const [result] = await connection.query(
                        'INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo) VALUES (?, ?, ?, ?, 0, 1)',
                        [account.cliente.tipo_cliente, account.nombre, account.email, account.cliente.estado],
                    );
                    clientId = Number(result.insertId);
                }
                const password = generatePassword();
                const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
                const [result] = await connection.query(
                    'INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo) VALUES (?, ?, ?, ?, 1)',
                    [clientId, account.email, passwordHash, account.rol],
                );
                created.push({ ...account, password, idUsuario: Number(result.insertId), creadoEn: new Date().toISOString() });
                console.log(`- ${account.key}: USUARIO id ${result.insertId} creado${clientId ? ` (CLIENTE id ${clientId})` : ''}.`);
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        }

        const file = saveCredentials(DB_NAME, DB_HOST, Number(DB_PORT), created);
        console.log('Credenciales guardadas (sin imprimir contrasenas) en:');
        console.log(`  ${file}`);
        console.log('No se creo cuenta corriente, credito ni movimientos contables.');
    } finally {
        await connection.end();
    }
}

main().catch(error => {
    console.error(`ERROR: ${error instanceof Error ? error.message : 'fallo desconocido'}.`);
    console.error('No se aplicaron cambios o la transaccion fue revertida.');
    process.exitCode = 1;
});
