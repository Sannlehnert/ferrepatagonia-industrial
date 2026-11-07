const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');

const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
const database = `cart_test_${token}`;
const container = `cart-test-${token}`;
const password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim();

async function main() {
    let started = false;
    let connection;

    try {
        // Puerto dinámico efímero en loopback
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

        // Espera no bloqueante cross-platform usando el driver nativo de mariadb
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
            throw new Error('MariaDB desechable no disponible tras 60 segundos.');
        }

        // Carga del esquema base
        const schemaPath = path.join(backend, '../database/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        for (const statement of schema.split(';').filter((s) => s.trim())) {
            await connection.query(statement);
        }

        console.log(JSON.stringify({
            database,
            port,
            version: await connection.query('SELECT VERSION() AS version'),
            image: info.Image
        }));

        // Ejecución de la suite inyectando variables efímeras sin tocar backend/.env
        const result = spawnSync(process.execPath, [
            '--require', './test/helpers/test-env.cjs',
            '--test', '--test-concurrency=1',
            'test/cart.test.cjs', 'test/cart.operations.test.cjs'
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
                CART_TEST_DATABASE: database
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
