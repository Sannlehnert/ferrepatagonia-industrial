// Preparacion local de usuarios de prueba con contrasenas reales (Sprint 7, T-S7-01.2).
//
// Uso (desde backend/, con backend/.env presente):
//   node scripts/prepare-local-users.cjs           # inspeccion sin mutaciones
//   node scripts/prepare-local-users.cjs --apply   # aplica con confirmacion explicita
//
// Reglas de seguridad:
// - Solo NODE_ENV=development. Nunca test ni production.
// - Identifica la instalacion completa antes de escribir: 25 tablas,
//   siete triggers y la vista de auditoria FER-17. Las bases parciales
//   o anteriores se rechazan sin mutaciones.
// - Nunca actualiza ni borra filas existentes: si el email ya tiene USUARIO lo
//   omite y conserva su contrasena y estado.
// - No crea cuenta corriente, movimientos ni credito.
// - Las contrasenas se generan aleatorias por cuenta y se escriben unicamente
//   en un archivo privado FUERA del repositorio (~/.ferrepatagonia-local),
//   con permisos 0600 en POSIX. Nunca se imprimen en consola ni logs.
// - Dos ejecuciones concurrentes se serializan con GET_LOCK de MariaDB. El
//   bloqueo cubre planificacion, insercion, COMMIT y escritura del archivo.
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

// Tiempo maximo de espera por el bloqueo cooperativo entre bootstraps.
const LOCK_TIMEOUT_SECONDS = 30;

const { readSchemaInventory, schemaErrors } = require('./lib/schema-inventory.cjs');

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

// Estado real de la transaccion para no afirmar una reversion inexistente.
let commitAttempted = false;
let transactionCommitted = false;

function fail(message) {
    console.error(`ERROR: ${message}`);
    process.exitCode = 1;
    return null;
}

async function identifyDatabase(connection) {
    const [[identity]] = await connection.query('SELECT DATABASE() AS base, VERSION() AS version');
    const inventory = await readSchemaInventory(async sql => (await connection.query(sql))[0]);
    return { ...identity, inventory };
}

function credentialsPath(database) {
    const configured = process.env.FERREPATAGONIA_LOCAL_DIR;
    if (configured !== undefined && !path.isAbsolute(configured)) {
        throw new Error('FERREPATAGONIA_LOCAL_DIR debe ser una ruta absoluta; usar una ubicacion fuera del repositorio.');
    }
    const dir = configured || path.join(os.homedir(), '.ferrepatagonia-local');
    return { dir, file: path.join(dir, `test-users-${database}.json`) };
}

// Nombre de bloqueo acotado a 64 caracteres (limite de MariaDB) y estable por base.
function lockName(database) {
    const digest = crypto.createHash('sha256').update(database).digest('hex').slice(0, 48);
    return `ferre.s7.${digest}`;
}

// Bloqueo cooperativo de MariaDB: serializa planificacion, escritura y archivo.
async function acquireLock(connection, database) {
    const name = lockName(database);
    const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [name, LOCK_TIMEOUT_SECONDS]);
    const acquired = rows[0] ? rows[0].acquired : null;
    if (acquired === null || acquired === undefined) {
        throw new Error('MariaDB no pudo otorgar el bloqueo cooperativo (GET_LOCK devolvio NULL).');
    }
    if (Number(acquired) !== 1) {
        throw new Error(`Otro bootstrap esta operando sobre la base "${database}" y no libero el bloqueo en ${LOCK_TIMEOUT_SECONDS}s.`
            + ' Esperar a que termine y reintentar; no se modifico nada.');
    }
    return name;
}

async function releaseLock(connection, name) {
    try {
        const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [name]);
        if (Number(rows[0] ? rows[0].released : 0) !== 1) {
            console.warn('ADVERTENCIA: el bloqueo cooperativo ya no estaba tomado por esta conexion.');
        }
    } catch (error) {
        // Al cerrar la conexion MariaDB libera el bloqueo automaticamente.
        console.warn(`ADVERTENCIA: no se pudo liberar el bloqueo explicitamente (${error.code ?? 'error'}); se liberara al cerrar la conexion.`);
    }
}

// Lee el documento previo antes de cualquier escritura en la base. Un JSON
// invalido debe abortar antes del COMMIT, no despues.
function loadCredentials(database) {
    const { dir, file } = credentialsPath(database);
    const empty = { database, host: null, port: null, generated_at: new Date().toISOString(), accounts: {} };
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return { dir, file, exists: false, document: empty };
        throw error;
    }
    let previous;
    try {
        previous = JSON.parse(text);
    } catch {
        throw new Error(`El archivo privado ${file} no contiene JSON valido. Moverlo o corregirlo manualmente antes de continuar; no se modifico la base.`);
    }
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)
        || !previous.accounts || typeof previous.accounts !== 'object' || Array.isArray(previous.accounts)) {
        throw new Error(`El archivo privado ${file} no tiene la estructura esperada (accounts). Corregirlo o moverlo manualmente; no se modifico la base.`);
    }
    if (previous.database !== database) {
        return { dir, file, exists: true, document: empty };
    }
    return { dir, file, exists: true, document: previous };
}

// Escritura atomica cuando el filesystem lo permite: temporal + fsync + rename
// dentro del mismo directorio. Nunca escribe directamente sobre el archivo final.
function writeCredentialsAtomic(dir, file, document) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
    const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    let descriptor;
    let dirDescriptor;
    try {
        descriptor = fs.openSync(temp, 'wx', 0o600);
        fs.writeFileSync(descriptor, JSON.stringify(document, null, 2) + '\n');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        if (process.platform !== 'win32') fs.chmodSync(temp, 0o600);
        fs.renameSync(temp, file);
        if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
        try {
            dirDescriptor = fs.openSync(dir, 'r');
            fs.fsyncSync(dirDescriptor);
        } catch {
            // fsync del directorio no esta disponible en todos los filesystems.
        } finally {
            if (dirDescriptor !== undefined) {
                try { fs.closeSync(dirDescriptor); } catch { /* sin accion */ }
            }
        }
    } catch (error) {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* sin accion */ }
        }
        try { fs.rmSync(temp, { force: true }); } catch { /* sin accion */ }
        throw error;
    }
}

// Conserva cuentas preexistentes y actualiza SOLO las credenciales de las
// cuentas realmente insertadas en esta ejecucion (incluye bases recreadas con
// el mismo DB_NAME, donde los ids y contrasenas son nuevos).
function saveCredentials(database, host, port, loaded, created) {
    const document = loaded.document;
    document.database = database;
    document.host = host;
    document.port = port;
    for (const account of created) {
        document.accounts[account.key] = {
            email: account.email,
            password: account.password,
            creado: account.creadoEn,
            id_usuario: account.idUsuario,
        };
    }
    document.generated_at = new Date().toISOString();
    writeCredentialsAtomic(loaded.dir, loaded.file, document);
    return { file: loaded.file, replaced: created.map(account => account.key) };
}

// Advertencia sin restablecer nada: usuarios existentes sin credencial privada.
function warnMissingCredentials(loaded, plans) {
    const omitted = plans.filter(plan => plan.action === 'omitido');
    if (omitted.length === 0) return;
    const missing = omitted.filter(plan => !loaded.document.accounts[plan.account.key]);
    if (missing.length === 0) return;
    console.warn(`ADVERTENCIA: ${missing.length} usuario(s) ya existen en la base (${missing.map(p => p.account.key).join(', ')})`);
    console.warn(`pero no tienen credencial en ${loaded.file}.`);
    console.warn('No se restablecen contrasenas automaticamente: eso cambiaria cuentas preexistentes.');
    console.warn('Para recuperar el acceso, usar una base desechable nueva o pedir a un administrador el restablecimiento manual.');
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

    let lock;
    try {
        lock = await acquireLock(connection, DB_NAME);
        // El documento se lee con el bloqueo tomado: la planificacion y la
        // escritura del archivo quedan serializadas con el resto del bootstrap.
        const loaded = loadCredentials(DB_NAME);

        const identity = await identifyDatabase(connection);
        const { tables, triggers, views } = identity.inventory;
        console.log(`Base: ${identity.base} (${identity.version}) en ${DB_HOST}:${DB_PORT}. Tablas: ${tables.length}, triggers: ${triggers.length}, vistas: ${views.length}.`);
        const errors = schemaErrors(identity.inventory, 'complete');
        if (errors.length) return fail(`La base "${identity.base}" no tiene el esquema completo. ${errors.join(' ')} Revisar database/README.md antes de continuar.`);

        const plans = [];
        for (const account of ACCOUNTS) {
            const plan = await planAccount(connection, account);
            plans.push(plan);
            console.log(`- ${account.key} (${account.email}): ${plan.action}${plan.detail ? ` — ${plan.detail}` : ''}`);
        }
        warnMissingCredentials(loaded, plans);

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
            commitAttempted = true;
            await connection.commit();
            transactionCommitted = true;
        } catch (error) {
            if (!transactionCommitted) {
                try { await connection.rollback(); } catch { /* el COMMIT pudo haber fallado: estado incierto */ }
            }
            throw error;
        }

        // El COMMIT ya ocurrio: un fallo de archivo NO revierte las cuentas.
        try {
            const saved = saveCredentials(DB_NAME, DB_HOST, Number(DB_PORT), loaded, created);
            console.log('Credenciales guardadas (sin imprimir contrasenas) en:');
            console.log(`  ${saved.file}`);
        } catch (error) {
            console.error('ERROR: la transaccion ya fue confirmada; las cuentas creadas persisten en la base de datos.');
            console.error(`No se pudieron guardar las credenciales en ${loaded.file}: ${error.code ?? error.message}.`);
            console.error('Las contrasenas generadas no quedaron registradas. No reintentar sobre esta base:');
            console.error('usar una base desechable nueva o restablecer las cuentas manualmente con un administrador.');
            process.exitCode = 1;
            return;
        }
        console.log('No se creo cuenta corriente, credito ni movimientos contables.');
    } finally {
        if (lock) await releaseLock(connection, lock);
        await connection.end();
    }
}

main().catch(error => {
    console.error(`ERROR: ${error instanceof Error ? error.message : 'fallo desconocido'}.`);
    if (transactionCommitted) {
        console.error('La transaccion ya estaba confirmada: los usuarios creados persisten; revisar el archivo privado de credenciales.');
    } else if (commitAttempted) {
        console.error('No se pudo confirmar el COMMIT: el estado real de la transaccion es incierto. Verificar la base antes de reintentar.');
    } else {
        console.error('La transaccion no se confirmo; si estaba abierta se intento revertir. No se crearon usuarios parciales.');
    }
    process.exitCode = 1;
});
