const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    docker, image, label, inspect, assertContainerOwner, newProfile, validateProfile, connectOwned, assertOwned
} = require('./cc260-disposable.cjs');

const backend = path.resolve(__dirname, '../..');
const runner = 251;

function findContainer(filter) {
    return docker('ps', '-aq', '--no-trunc', '--filter', filter);
}

async function removeOwnContainer(profile) {
    // A failed Docker CLI call can leave a container without returning its ID.
    const filter = profile.id ? `id=${profile.id}` : `name=^/${profile.container}$`;
    let id = findContainer(filter);
    if (!profile.id) {
        for (let attempt = 0; !id && attempt < 10; attempt++) {
            await delay(200);
            id = findContainer(filter);
        }
    }
    if (!id) return;

    try {
        assertContainerOwner(profile, id, inspect(id), runner);
        docker('rm', '-f', '-v', id);
    } catch (error) {
        // --rm can remove a stopped container between listing and inspection.
        if (findContainer(`id=${id}`)) throw error;
        return;
    }
    assert.equal(findContainer(`id=${id}`), '', 'Docker dejó el contenedor descartable');
}

async function applySql(session, filePath) {
    await assertOwned(session);
    const { id, password, database } = session.profile;
    execFileSync('docker', ['exec', '-i', id, 'mariadb', '-uroot', `-p${password}`, database], {
        input: fs.readFileSync(filePath), stdio: 'pipe', windowsHide: true, timeout: 60000
    });
}

async function run() {
    const profile = newProfile(runner);
    const errors = [];
    let session;
    let child;
    let interruption;
    let killTimer;
    let exitCode = 1;

    function interrupt(reason) {
        interruption ??= reason;
        if (child && !killTimer) {
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
        }
    }

    function checkInterrupted() {
        assert.ok(!interruption, `Suite #251 interrumpida (${interruption})`);
    }

    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    try {
        const id = docker(
            'run', '--rm', '-d', '--name', profile.container, '--label', label(profile, runner),
            '--tmpfs', '/var/lib/mysql:rw', '-p', `${profile.host}::3306`,
            '-e', `MARIADB_ROOT_PASSWORD=${profile.password}`, '-e', `MARIADB_DATABASE=${profile.database}`, image
        );
        const info = inspect(id);
        profile.id = id;
        profile.port = Number(info.NetworkSettings.Ports['3306/tcp']?.[0]?.HostPort);
        validateProfile(profile, info, runner);

        for (let attempt = 0; attempt < 60; attempt++) {
            checkInterrupted();
            try {
                session = await connectOwned(profile, runner);
                break;
            } catch (error) {
                if (error.code === 'ERR_ASSERTION' || error instanceof AggregateError || attempt === 59) throw error;
                await delay(1000);
            }
        }

        checkInterrupted();
        await applySql(session, path.join(backend, '../database/schema.sql'));
        checkInterrupted();
        await applySql(session, path.join(backend, '../database/migrate-fer-20-account-movements.sql'));
        checkInterrupted();

        // The file uses node:test directly, so there is no test worker to orphan.
        child = spawn(process.execPath, ['--require', './test/helpers/test-env.cjs', 'test/cuentaCorriente.client.test.cjs'], {
            cwd: backend,
            stdio: 'inherit',
            windowsHide: true,
            env: {
                ...process.env,
                NODE_ENV: 'test',
                DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
                JWT_SECRET: randomUUID(),
                DB_HOST: profile.host,
                DB_PORT: String(profile.port),
                DB_NAME: profile.database,
                DB_USER: 'root',
                DB_PASSWORD: profile.password,
                CC251_TEST_PROFILE: JSON.stringify(profile)
            }
        });
        const timeout = setTimeout(() => interrupt('tiempo agotado'), 240000);
        try {
            const [code, signal] = await once(child, 'exit');
            exitCode = code ?? 1;
            checkInterrupted();
            assert.equal(code, 0, `Suite #251 falló (exit ${code ?? signal})`);
        } finally {
            clearTimeout(timeout);
            clearTimeout(killTimer);
            child = undefined;
        }
    } catch (error) {
        errors.push(error);
    } finally {
        try {
            if (session) await session.connection.end();
        } catch (error) {
            errors.push(new Error(`Cierre de MariaDB #251: ${error.message}`));
        } finally {
            try {
                await removeOwnContainer(profile);
            } catch (error) {
                errors.push(new Error(`Limpieza de Docker #251: ${error.message}`));
            }
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', interrupt);
        }
    }

    if (interruption && !errors.length) errors.push(new Error(`Suite #251 interrumpida (${interruption})`));
    for (const error of errors) report(error, profile.password);
    return errors.length ? exitCode || 1 : 0;
}

function report(error, password) {
    console.error(error.message.replaceAll(password, '[oculta]'));
    if (error instanceof AggregateError) {
        for (const cause of error.errors) report(cause, password);
    }
}

if (require.main === module) run().then(code => { process.exitCode = code; });
module.exports = { run };
