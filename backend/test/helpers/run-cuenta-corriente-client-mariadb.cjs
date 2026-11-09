const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');

const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
const database = `cc_client_test_${token}`;
const container = `cc-client-test-${token}`;
const password = randomUUID();

const docker = (...args) =>
    execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim();

function runSqlViaDocker(containerName, filePath, dbName, dbPassword) {
    const sqlContent = fs.readFileSync(filePath);
    execFileSync(
        'docker',
        ['exec', '-i', containerName, 'mariadb', '-uroot', `-p${dbPassword}`, dbName],
        { input: sqlContent, timeout: 60000 }
    );
}

async function main() {
    let started = false;
    let connection;
    try {
        docker(
            'run',
            '--rm',
            '-d',
            '--name',
            container,
            '-p',
            '127.0.0.1::3306',
            '-e',
            `MARIADB_ROOT_PASSWORD=${password}`,
            '-e',
            `MARIADB_DATABASE=${database}`,
            'mariadb:11.4'
        );
        started = true;

        const info = JSON.parse(docker('inspect', container))[0];
        const port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);

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
            throw new Error('MariaDB descartable no disponible para suite #251');
        }

        const schemaPath = path.join(backend, '../database/schema.sql');
        runSqlViaDocker(container, schemaPath, database, password);

        const migrationPath = path.join(backend, '../database/migrate-fer-20-account-movements.sql');
        if (fs.existsSync(migrationPath)) {
            runSqlViaDocker(container, migrationPath, database, password);
        }

        const result = spawnSync(
            process.execPath,
            [
                '--require',
                './test/helpers/test-env.cjs',
                '--test',
                '--test-concurrency=1',
                'test/cuentaCorriente.client.test.cjs'
            ],
            {
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
                    CUENTA_CORRIENTE_CLIENT_TEST_DATABASE: database,
                    CUENTA_CORRIENTE_TEST_DATABASE: database
                }
            }
        );

        if (result.error) throw result.error;
        process.exitCode = result.status === 0 ? 0 : 1;
    } finally {
        if (connection) await connection.end();
        if (started) docker('rm', '-f', '-v', container);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});