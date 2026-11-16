const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mariadb = require('mariadb');

const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
// El nombre debe respetar el guard de integración (DB aislada de prueba).
const database = `admin_products_test_${token}`;
const container = `s7-03-1-audit-${token}`;
const password = randomUUID();
const labelKey = 'ferrepatagonia.s7-03-1-audit';
const labelValue = token;
const image = 'mariadb:11.4';

// Inventario exacto de database/schema.sql. FER17_PRECIO_EVENTO es la extensión
// legítima de #320; cualquier tabla faltante o adicional invalida la auditoría.
const expectedTables = [
    'CARRITO', 'CATEGORIA', 'CLIENTE', 'COMPROBANTE_PAGO', 'CONFIRMACION_PEDIDO_CC',
    'COTIZACION', 'CUENTA_CORRIENTE', 'DETALLE_PEDIDO', 'DETALLE_PEDIDO_CC_PRECIO',
    'FER17_CALENDARIO', 'FER17_COTIZACION_VERIFICACION', 'FER17_LISTA_INACTIVA_EVENTO',
    'FER17_PRECIO_EVENTO', 'IMPUTACION_MOVIMIENTO_CUENTA', 'ITEM_CARRITO', 'LISTA_PRECIO',
    'MOVIMIENTO_CUENTA_CORRIENTE', 'PAGO', 'PEDIDO', 'PRECIO_USD_EVIDENCIA', 'PRODUCTO',
    'USUARIO',
];

// Permite ejecutar el runner tanto desde Linux/WSL (docker) como desde
// Windows (docker.exe). Solo se acepta un motor con daemon disponible.
function resolveDocker() {
    for (const candidate of ['docker', 'docker.exe']) {
        try {
            execFileSync(candidate, ['version', '--format', '{{.Server.Version}}'], {
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 30000,
                windowsHide: true,
            });
            return candidate;
        } catch {
            // Probar el siguiente binario.
        }
    }
    throw new Error('No hay un motor Docker con daemon disponible para la auditoría aislada.');
}

const dockerBin = resolveDocker();
const docker = (...args) => execFileSync(dockerBin, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 180000,
    windowsHide: true,
}).trim();

function applySql(sqlFile) {
    const result = spawnSync(dockerBin, [
        'exec', '-i', container,
        'mariadb', '-uroot', `-p${password}`, database,
    ], {
        input: fs.readFileSync(sqlFile),
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Falló ${path.basename(sqlFile)}: ${result.stderr || result.stdout}`);
    }
}

async function main() {
    let started = false;
    let connection;
    let interrupted = false;

    const signal = () => { interrupted = true; };
    process.on('SIGINT', signal);
    process.on('SIGTERM', signal);

    try {
        console.log(`[T-S7-03.1] Creando MariaDB descartable aislada (${container})...`);
        docker('run', '--rm', '-d', '--name', container, '--label', `${labelKey}=${labelValue}`,
            '--tmpfs', '/var/lib/mysql:rw',
            '-p', '127.0.0.1::3306',
            '-e', `MARIADB_ROOT_PASSWORD=${password}`,
            '-e', `MARIADB_DATABASE=${database}`,
            image);
        started = true;

        const info = JSON.parse(docker('inspect', container))[0];
        assert.equal(info.Config.Image, image);
        assert.equal(info.Config.Labels[labelKey], labelValue);
        assert.equal(info.State.Running, true);
        const binding = info.NetworkSettings.Ports['3306/tcp'];
        assert.ok(
            Array.isArray(binding) && binding.length === 1 &&
            binding[0].HostIp === '127.0.0.1' && Number(binding[0].HostPort) > 0,
            'La base debe publicarse solo en loopback con puerto dinámico',
        );
        assert.ok(info.HostConfig.Tmpfs?.['/var/lib/mysql'], 'La base debe usar tmpfs');
        assert.ok(info.Mounts.every(mount => mount.Type === 'tmpfs'), 'Sin volúmenes persistentes');
        const port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);

        for (let attempt = 0; attempt < 60 && !interrupted; attempt++) {
            try {
                connection = await mariadb.createConnection({
                    host: '127.0.0.1',
                    port,
                    user: 'root',
                    password,
                    database,
                    connectTimeout: 1000,
                });
                break;
            } catch (error) {
                if (attempt === 59) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        assert.ok(connection && !interrupted, 'MariaDB descartable no disponible');
        console.log(`[T-S7-03.1] MariaDB ${database} escuchando en 127.0.0.1:${port}`);

        applySql(path.join(backend, '../database/schema.sql'));
        applySql(path.join(backend, '../database/migrate-fer-20-account-movements.sql'));

        const [identity] = await connection.query('SELECT DATABASE() AS base');
        assert.equal(identity.base, database, 'La auditoría debe ejecutarse sobre la base aislada creada');

        const tables = await connection.query(`
            SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `, [database]);
        assert.deepEqual(
            tables.map(row => row.TABLE_NAME),
            expectedTables,
            'El esquema aislado debe tener exactamente las 22 tablas vigentes, incluida FER17_PRECIO_EVENTO',
        );

        const triggers = await connection.query(`
            SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = ?
            ORDER BY TRIGGER_NAME
        `, [database]);
        assert.deepEqual(
            triggers.map(row => row.TRIGGER_NAME),
            ['fer260_cuenta_revision', 'fer260_imputacion_insert', 'fer260_imputacion_update'],
            'El esquema aislado debe tener los 3 triggers FER-20',
        );

        console.log('[T-S7-03.1] Esquema verificado: 22 tablas y 3 triggers FER-20.');
        console.log('[T-S7-03.1] Ejecutando company-approval-audit.test.cjs...');

        const result = spawnSync(process.execPath, [
            '--require', './test/helpers/test-env.cjs',
            '--test',
            '--test-concurrency=1',
            'test/company-approval-audit.test.cjs',
        ], {
            cwd: backend,
            stdio: 'inherit',
            env: {
                ...process.env,
                NODE_ENV: 'test',
                DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
                JWT_SECRET: randomUUID(),
                DB_HOST: '127.0.0.1',
                DB_PORT: String(port),
                DB_NAME: database,
                DB_USER: 'root',
                DB_PASSWORD: password,
                ADMIN_PRODUCTS_TEST_DATABASE: database,
            },
            windowsHide: true,
        });

        if (result.error) throw result.error;
        process.exitCode = result.status === 0 ? 0 : 1;
        console.log(`[T-S7-03.1] Suite finalizada con código ${result.status}.`);
    } finally {
        if (connection) await connection.end().catch(() => {});
        if (started) {
            console.log(`[T-S7-03.1] Eliminando contenedor descartable ${container}...`);
            try {
                docker('rm', '-f', '-v', container);
            } catch {
                // El contenedor pudo haberse eliminado por --rm.
            }
        }
        process.removeListener('SIGINT', signal);
        process.removeListener('SIGTERM', signal);
    }
}

main().catch(error => {
    console.error('[T-S7-03.1] Error fatal:', error.message);
    process.exitCode = 1;
});
