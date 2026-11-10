const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const backend = path.resolve(__dirname, '../..');
const { newProfile, docker, connectOwned, validateProfile } = require('./cc260-disposable.cjs');

async function closeSession(s) {
    if (!s) return;
    try {
        const conn = s.connection || s;
        if (typeof conn.end === 'function') {
            await conn.end();
        }
    } catch {
        // Silencioso en contenedor descartable
    }
}

async function run() {
    const p = newProfile();
    let session = null;
    let child = null;
    let interrupted = false;
    const signal = () => {
        interrupted = true;
        child?.kill('SIGTERM');
    };
    process.on('SIGINT', signal);
    process.on('SIGTERM', signal);

    try {
        p.id = docker(
            'run', '--rm', '-d', '--name', p.container,
            '--label', `ferrepatagonia.cc260-test=${p.token}`,
            '--tmpfs', '/var/lib/mysql:rw',
            '-p', '127.0.0.1::3306',
            '-e', `MARIADB_ROOT_PASSWORD=${p.password}`,
            '-e', `MARIADB_DATABASE=${p.database}`,
            'mariadb:11.4',
        );
        const info = JSON.parse(docker('inspect', p.id))[0];
        p.port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);

        for (let n = 0; n < 60 && !interrupted; n++) {
            try {
                session = await connectOwned(p);
                break;
            } catch (e) {
                if (n === 59) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        assert.ok(session && !interrupted, 'MariaDB descartable no disponible');

        // Cerramos la sesión de sondeo de inmediato para que no queden sockets activos
        await closeSession(session);
        session = null;

        const apply = file => {
            validateProfile(p, JSON.parse(docker('inspect', p.id))[0]);
            const result = spawnSync(
                'docker',
                ['exec', '-i', p.id, 'mariadb', '-uroot', `-p${p.password}`, p.database],
                { input: fs.readFileSync(file), encoding: 'utf8', windowsHide: true, timeout: 60000 },
            );
            if (result.status !== 0) throw Error(`SQL ${path.basename(file)}: ${result.stderr}`);
        };

        apply(path.join(backend, '../database/schema.sql'));

        const migrations = [
            '../database/migrate-fer-20-account-movements.sql',
            '../database/migrate-fer-20-order-confirmation.sql',
        ];
        for (const m of migrations) {
            const fullPath = path.join(backend, m);
            if (fs.existsSync(fullPath)) {
                apply(fullPath);
            }
        }

        const testFiles = ['test/admin-orders.mariadb.test.cjs'];

        const code = await new Promise((resolve, reject) => {
            child = spawn(
                process.execPath,
                ['--require', './test/helpers/test-env.cjs', '--test', '--test-concurrency=1', ...testFiles],
                {
                    cwd: backend,
                    stdio: 'inherit',
                    windowsHide: true,
                    env: {
                        ...process.env,
                        NODE_ENV: 'test',
                        TZ: 'UTC',
                        DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
                        JWT_SECRET: randomUUID(),
                        DB_HOST: p.host,
                        DB_PORT: String(p.port),
                        DB_NAME: p.database,
                        DB_USER: 'root',
                        DB_PASSWORD: p.password,
                        CC260_TEST_PROFILE: JSON.stringify(p),
                    },
                },
            );
            child.on('error', reject);
            child.on('exit', (exitCode, sig) => {
                if (sig) reject(new Error(`Test process killed with signal ${sig}`));
                else resolve(exitCode ?? 0);
            });
        });

        if (code !== 0) {
            process.exitCode = code;
        }
    } finally {
        process.off('SIGINT', signal);
        process.off('SIGTERM', signal);
        await closeSession(session);
        if (p.id) {
            try {
                docker('rm', '-f', '-v', p.id);
            } catch {}
        }
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});