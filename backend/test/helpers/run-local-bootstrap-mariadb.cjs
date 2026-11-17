// Runner aislado de T-S7-01.2: MariaDB 11.4 descartable (tmpfs, auto-remove).
// Ejecuta el bootstrap local y sus pruebas sin tocar la base persistente.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { docker, newProfile, connectOwned, validateProfile } = require('./cc260-disposable.cjs');
const { applyFile, image } = require('./local-bootstrap-db.cjs');

const backend = path.resolve(__dirname, '../..');

async function run() {
    const profile = newProfile();
    let session;
    let child;
    let interrupted = false;
    const signal = () => { interrupted = true; child?.kill('SIGTERM'); };
    process.on('SIGINT', signal);
    process.on('SIGTERM', signal);
    try {
        profile.id = docker('run', '--rm', '-d', '--name', profile.container,
            '--label', `ferrepatagonia.cc260-test=${profile.token}`,
            '--tmpfs', '/var/lib/mysql:rw', '-p', '127.0.0.1::3306',
            '-e', `MARIADB_ROOT_PASSWORD=${profile.password}`,
            '-e', `MARIADB_DATABASE=${profile.database}`, image);
        const info = JSON.parse(docker('inspect', profile.id))[0];
        profile.port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);
        for (let attempt = 0; attempt < 60 && !interrupted; attempt += 1) {
            try { session = await connectOwned(profile); break; }
            catch (error) { if (attempt === 59) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
        }
        assert.ok(session && !interrupted, 'MariaDB descartable no disponible');
        applyFile(profile, path.join(backend, '../database/schema.sql'));
        applyFile(profile, path.join(backend, '../database/migrate-fer-20-account-movements.sql'));
        applyFile(profile, path.join(backend, '../database/migrate-fer-17-price-verification.sql'));
        console.log(JSON.stringify({ mode: 'local-bootstrap', database: profile.database, host: profile.host,
            port: profile.port, container: profile.container }));

        const code = await new Promise((resolve, reject) => {
            child = spawn(process.execPath, ['--require', './test/helpers/test-env.cjs', '--test',
                '--test-concurrency=1', 'test/local-bootstrap.mariadb.test.cjs'], {
                cwd: backend, stdio: 'inherit', windowsHide: true,
                env: { ...process.env, NODE_ENV: 'test', TZ: 'UTC',
                    DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
                    JWT_SECRET: randomUUID(), DB_HOST: profile.host, DB_PORT: String(profile.port),
                    DB_NAME: profile.database, DB_USER: 'root', DB_PASSWORD: profile.password,
                    CC260_TEST_PROFILE: JSON.stringify(profile) },
            });
            const timeout = setTimeout(() => { interrupted = true; child.kill('SIGTERM'); }, 300000);
            child.on('error', error => { clearTimeout(timeout); reject(error); });
            child.on('exit', exitCode => { clearTimeout(timeout); child = null; resolve(exitCode); });
        });
        assert.equal(code, 0, `Suite T-S7-01.2 fallo (exit ${code})`);
        assert.equal(interrupted, false);
    } finally {
        process.off('SIGINT', signal);
        process.off('SIGTERM', signal);
        try {
            if (session) await session.connection.end();
        } finally {
            if (profile.id) {
                validateProfile(profile, JSON.parse(docker('inspect', profile.id))[0]);
                docker('rm', '-f', '-v', profile.id);
                assert.equal(docker('ps', '-aq', '--filter', `label=ferrepatagonia.cc260-test=${profile.token}`), '');
                console.log('CLEANUP OK T-S7-01.2: contenedor eliminado, datos tmpfs, sin volumen persistente.');
            }
        }
    }
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
