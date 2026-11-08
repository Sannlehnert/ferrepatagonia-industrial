// backend/test/helpers/run-cuenta-corriente-mariadb.cjs
const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');

const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
const database = `audit_cc_${token}`;
const container = `audit-cc-${token}`;
const password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim();

async function main() {
    let started = false;
    let connection;

    try {
        docker(
            'run', '--rm', '-d',
            '--name', container,
            '-p', '127.0.0.1::3306',
            '-e', `MARIADB_ROOT_PASSWORD=${password}`,
            '-e', `MARIADB_DATABASE=${database}`,
            'mariadb:11.4'
        );
        started = true;

        const info = JSON.parse(docker('inspect', container))[0];
        const port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);

        // Espera no bloqueante cross-platform con mariadb driver
        for (let i = 0; i < 60; i++) {
            try {
                connection = await mariadb.createConnection({
                    host: '127.0.0.1',
                    port,
                    user: 'root',
                    password,
                    database,
                    connectTimeout: 1000
                });
                break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        if (!connection) {
            throw new Error('MariaDB descartable no disponible tras 60 segundos.');
        }

        // Función para aplicar archivos SQL mediante el cliente mariadb dentro del contenedor (soporta DELIMITER //)
        const applySqlFile = (filePath) => {
            const input = fs.readFileSync(filePath);
            const res = spawnSync('docker', [
                'exec', '-i', container,
                'mariadb', '--default-character-set=utf8mb4',
                '-u', 'root', `-p${password}`, database
            ], { input, stdio: ['pipe', 'inherit', 'inherit'] });
            if (res.status !== 0) {
                throw new Error(`Fallo al aplicar ${filePath} en MariaDB descartable.`);
            }
        };

        // 1. Cargar esquema canónico base
        applySqlFile(path.join(backend, '../database/schema.sql'));

        // 2. Cargar migración de cuenta corriente dos veces consecutivas para verificar idempotencia
        const migrationPath = path.join(backend, '../database/migrate-fer-20-account-movements.sql');
        if (fs.existsSync(migrationPath)) {
            applySqlFile(migrationPath);
            applySqlFile(migrationPath);
        }

        console.log(JSON.stringify({
            database,
            port,
            version: await connection.query('SELECT VERSION() AS version'),
            image: info.Image
        }));

        // 3. Ejecutar la suite inyectando variables efímeras seguras (sin cargar .env)
        const result = spawnSync(process.execPath, [
            '--require', './test/helpers/test-env.cjs',
            '--test',
            'test/cuentaCorriente.test.cjs'
        ], {
            cwd: backend,
            stdio: 'inherit',
            env: {
                ...process.env,
                DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
                JWT_SECRET: randomUUID(),
                DB_HOST: '127.0.0.1',
                DB_PORT: String(port),
                DB_NAME: database,
                DB_USER: 'root',
                DB_PASSWORD: password,
                CUENTA_CORRIENTE_TEST_DATABASE: database
            }
        });

        if (result.error) throw result.error;
        process.exitCode = result.status === 0 ? 0 : 1;
    } finally {
        if (connection) {
            try { await connection.end(); } catch {}
        }
        if (started) {
            docker('rm', '-f', '-v', container);
        }
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});