// T-S7-01.2: bootstrap local reproducible, recreacion con el mismo DB_NAME,
// concurrencia, fallo de credenciales y login real. Solo MariaDB descartable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');
const bcrypt = require('bcryptjs');
const { childProfile } = require('./helpers/cc260-disposable.cjs');
const { createDatabase, removeDatabase, connectProfile } = require('./helpers/local-bootstrap-db.cjs');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');
const { startHttpApp } = require('./helpers/start-http-app.cjs');

const backend = path.resolve(__dirname, '..');
const script = path.join(backend, 'scripts/prepare-local-users.cjs');
const noDotenv = path.join(backend, 'test/helpers/nonexistent.env');
const isWindows = process.platform === 'win32';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let primary;
let credentialsDir;
let extraDatabases = [];
let application;
let base;
let firstPasswords = {};

function childEnv(profile, dir, nodeEnv = 'development') {
    return { ...process.env, NODE_ENV: nodeEnv, TZ: 'UTC', DOTENV_CONFIG_PATH: noDotenv,
        DB_HOST: profile.host, DB_PORT: String(profile.port), DB_NAME: profile.database,
        DB_USER: 'root', DB_PASSWORD: profile.password, FERREPATAGONIA_LOCAL_DIR: dir };
}

function bootstrap(profile, { dir = credentialsDir, nodeEnv = 'development' } = {}) {
    return spawnSync(process.execPath, ['scripts/prepare-local-users.cjs', '--apply'], {
        cwd: backend, env: childEnv(profile, dir, nodeEnv), encoding: 'utf8', windowsHide: true, timeout: 180000,
    });
}

function bootstrapAsync(profile, { dir = credentialsDir } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/prepare-local-users.cjs', '--apply'], {
            cwd: backend, env: childEnv(profile, dir), windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); resolve({ status: code, stdout, stderr }); });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Bootstrap concurrente excedio el timeout'));
        }, 120000);
        timer.unref();
    });
}

function credentialsFile(dir = credentialsDir) {
    return path.join(dir, `test-users-${primary.database}.json`);
}

function readCredentials(dir = credentialsDir) {
    return JSON.parse(fs.readFileSync(credentialsFile(dir), 'utf8'));
}

async function withConnection(profile, work) {
    const connection = await connectProfile(profile);
    try {
        return await work(connection);
    } finally {
        await connection.end();
    }
}

async function assertPasswords(profile, credentials) {
    const accounts = Object.values(credentials.accounts);
    assert.equal(accounts.length, 4);
    await withConnection(profile, async db => {
        const rows = await db.query(`
            SELECT u.email, u.password_hash, u.rol, u.activo,
                   c.tipo_cliente, c.estado_aprobacion_empresa
            FROM USUARIO u LEFT JOIN CLIENTE c ON c.id_cliente = u.id_cliente
            ORDER BY u.email
        `);
        assert.equal(rows.length, 4, 'Deben existir exactamente los cuatro usuarios');
        const byEmail = new Map(accounts.map(account => [account.email, account]));
        for (const row of rows) {
            const account = byEmail.get(row.email);
            assert.ok(account, `Falta credencial para ${row.email}`);
            assert.equal(Number(row.activo), 1);
            assert.equal(await bcrypt.compare(account.password, row.password_hash), true,
                `La contrasena guardada no permite iniciar sesion como ${row.email}`);
        }
        const [counts] = await db.query(`
            SELECT (SELECT COUNT(*) FROM CUENTA_CORRIENTE) AS cuentas,
                   (SELECT COUNT(*) FROM MOVIMIENTO_CUENTA_CORRIENTE) AS movimientos
        `);
        assert.equal(Number(counts.cuentas), 0, 'El bootstrap no crea cuenta corriente');
        assert.equal(Number(counts.movimientos), 0, 'El bootstrap no crea movimientos');
    });
}

async function hashes(profile) {
    return withConnection(profile, db => db.query('SELECT email, password_hash FROM USUARIO ORDER BY email'));
}

async function login(profileName, credentials) {
    const account = credentials.accounts[profileName];
    const response = await fetchFromBrowser(`${base}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: account.password }),
    });
    const body = await response.json();
    const rawCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
    const cookie = rawCookie ? rawCookie.split(';')[0] : '';
    return { response, body, cookie };
}

before(async () => {
    primary = childProfile();
    credentialsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferre-local-credentials-'));
});

after(async () => {
    try {
        if (application) await application.close();
    } finally {
        for (const profile of extraDatabases) {
            try { removeDatabase(profile); } catch { /* la limpieza del runner cubre el principal */ }
        }
        fs.rmSync(credentialsDir, { recursive: true, force: true });
    }
});

test('bootstrap inicial crea cuatro perfiles y credenciales validas', async () => {
    const first = await createDatabase(primary.database);
    extraDatabases.push(first);
    const result = bootstrap(first);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const credentials = readCredentials();
    assert.equal(credentials.database, primary.database);
    assert.deepEqual(Object.keys(credentials.accounts).sort(), ['admin', 'aprobada', 'particular', 'pendiente']);
    await assertPasswords(first, credentials);
    firstPasswords = Object.fromEntries(Object.entries(credentials.accounts).map(([key, account]) => [key, account.password]));
});

test('recrear una base limpia con el mismo DB_NAME actualiza las contrasenas del JSON', async () => {
    // primary ya es una instancia limpia y distinta, con el mismo DB_NAME que la anterior.
    const result = bootstrap(primary);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const credentials = readCredentials();
    assert.equal(credentials.database, primary.database);
    for (const [key, password] of Object.entries(firstPasswords)) {
        assert.notEqual(credentials.accounts[key].password, password,
            `La credencial ${key} conservo la contrasena de la base anterior`);
    }
    await assertPasswords(primary, credentials);
});

test('reejecucion secuencial es idempotente y no reescribe credenciales', async () => {
    const beforeFile = fs.readFileSync(credentialsFile(), 'utf8');
    const beforeHashes = await hashes(primary);
    const result = bootstrap(primary);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Nada por crear/);
    assert.equal(fs.readFileSync(credentialsFile(), 'utf8'), beforeFile);
    assert.deepEqual(await hashes(primary), beforeHashes);
    await assertPasswords(primary, readCredentials());

    const rejected = bootstrap(primary, { nodeEnv: 'test' });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /solo opera en desarrollo explicito/);
    assert.equal(fs.readFileSync(credentialsFile(), 'utf8'), beforeFile);

    const relative = bootstrap(primary, { dir: 'credenciales-relativas' });
    assert.equal(relative.status, 1);
    assert.match(relative.stderr, /ruta absoluta; usar una ubicacion fuera del repositorio/);
    assert.equal(fs.existsSync(path.join(backend, 'credenciales-relativas')), false);
    assert.equal(fs.readFileSync(credentialsFile(), 'utf8'), beforeFile);
});

test('login real de los cuatro perfiles, separacion ADMIN/CLIENTE y reinicio', async () => {
    const credentials = readCredentials();
    application = await startHttpApp({ HTTP_TEST_DATABASE: '1' });
    base = `${application.base}/api`;
    try {
        const roles = { admin: 'ADMIN', particular: 'CLIENTE', pendiente: 'CLIENTE', aprobada: 'CLIENTE' };
        for (const [key, role] of Object.entries(roles)) {
            const { response, body, cookie } = await login(key, credentials);
            assert.equal(response.status, 200, `Login ${key}: ${JSON.stringify(body)}`);
            assert.equal(body.user.rol, role);
            assert.ok(cookie, `Login ${key} debe emitir cookie HttpOnly`);

            const me = await fetchFromBrowser(`${base}/auth/me`, { headers: { Cookie: cookie } });
            assert.equal(me.status, 200);
            const meBody = await me.json();
            assert.equal(meBody.user.rol, role);
            assert.equal(meBody.user.email, credentials.accounts[key].email);

            const admin = await fetchFromBrowser(`${base}/admin/clientes`, { headers: { Cookie: cookie } });
            assert.equal(admin.status, role === 'ADMIN' ? 200 : 403, `Rol ${role} en ruta administrativa`);
        }
    } finally {
        await application.close();
        application = undefined;
    }

    // Reinicio real del backend en otro proceso: las cuentas persisten en MariaDB.
    application = await startHttpApp({ HTTP_TEST_DATABASE: '1' });
    base = `${application.base}/api`;
    try {
        for (const key of Object.keys(credentials.accounts)) {
            const { response } = await login(key, credentials);
            assert.equal(response.status, 200, `Login ${key} tras reiniciar`);
        }
        const rows = await withConnection(primary, db => db.query(
            'SELECT COUNT(*) AS cuentas FROM CUENTA_CORRIENTE',
        ));
        assert.equal(Number(rows[0].cuentas), 0);
    } finally {
        await application.close();
        application = undefined;
    }
});

test('dos bootstraps concurrentes sobre una base vacia no duplican ni corrompen', async () => {
    const concurrent = await createDatabase(primary.database);
    extraDatabases.push(concurrent);
    const [first, second] = await Promise.all([bootstrapAsync(concurrent), bootstrapAsync(concurrent)]);
    for (const [name, result] of [['primero', first], ['segundo', second]]) {
        assert.equal(result.status, 0, `${name}: ${result.stderr}${result.stdout}`);
    }
    assert.ok([first.stdout, second.stdout].some(output => /creado/.test(output)));
    const credentials = readCredentials();
    await assertPasswords(concurrent, credentials);
    const leftovers = fs.readdirSync(credentialsDir).filter(name => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'No deben quedar temporales de escritura');
    await withConnection(concurrent, async db => {
        const [row] = await db.query('SELECT COUNT(*) AS total FROM USUARIO');
        assert.equal(Number(row.total), 4);
    });
});

test('un fallo al escribir credenciales no afirma rollback y conserva los usuarios', { skip: isWindows || isRoot }, async () => {
    const failing = await createDatabase(primary.database);
    extraDatabases.push(failing);
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ferre-local-readonly-'));
    try {
        fs.chmodSync(parent, 0o500);
        const target = path.join(parent, 'credenciales');
        const result = bootstrap(failing, { dir: target });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /transaccion ya fue confirmada|transacción ya fue confirmada/i);
        assert.match(result.stderr, /no quedaron registradas/i);
        assert.equal(fs.existsSync(credentialsFile(target)), false);
        await withConnection(failing, async db => {
            const [row] = await db.query('SELECT COUNT(*) AS total FROM USUARIO');
            assert.equal(Number(row.total), 4, 'El COMMIT no se revierte por un fallo de archivo');
        });
    } finally {
        fs.chmodSync(parent, 0o700);
        fs.rmSync(parent, { recursive: true, force: true });
    }
});

test('si existen usuarios y falta el JSON solo advierte, sin restablecer contrasenas', async () => {
    const beforeHashes = await hashes(primary);
    fs.rmSync(credentialsFile(), { force: true });
    const result = bootstrap(primary);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stderr, /No se restablecen contrasenas automaticamente/);
    assert.equal(fs.existsSync(credentialsFile()), false);
    assert.deepEqual(await hashes(primary), beforeHashes);
});
