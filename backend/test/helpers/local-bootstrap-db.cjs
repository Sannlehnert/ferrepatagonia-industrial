// Instancias MariaDB descartables para T-S7-01.2. Reutiliza el perfil de #260
// (loopback, tmpfs, sin volumen, imagen 11.4) y valida el contenedor localmente
// porque una recreacion conserva DB_NAME pero usa otro token de contenedor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mariadb = require('mariadb');
const { docker, newProfile } = require('./cc260-disposable.cjs');

const backend = path.resolve(__dirname, '../..');
const image = 'mariadb:11.4';

function inspectOwned(profile) {
    assert.match(profile.id, /^[a-f0-9]{64}$/, 'ID de contenedor invalido');
    assert.equal(profile.host, '127.0.0.1', 'Solo loopback');
    const info = JSON.parse(docker('inspect', profile.id))[0];
    assert.equal(info.Name, `/${profile.container}`);
    assert.equal(info.Config.Labels['ferrepatagonia.cc260-test'], profile.token);
    assert.equal(info.Config.Image, image);
    assert.equal(info.Config.Hostname, profile.id.slice(0, 12));
    assert.equal(info.State.Running, true);
    assert.ok(info.Config.Env.includes(`MARIADB_DATABASE=${profile.database}`));
    assert.ok(info.Config.Env.includes(`MARIADB_ROOT_PASSWORD=${profile.password}`));
    assert.deepEqual(info.NetworkSettings.Ports['3306/tcp'],
        [{ HostIp: profile.host, HostPort: String(profile.port) }]);
    assert.equal(info.HostConfig.AutoRemove, true);
    assert.ok(info.HostConfig.Tmpfs?.['/var/lib/mysql']);
    assert.ok(info.Mounts.every(mount => mount.Type === 'tmpfs'));
    return info;
}

async function connectProfile(profile) {
    const info = inspectOwned(profile);
    const connection = await mariadb.createConnection({ host: profile.host, port: profile.port,
        user: 'root', password: profile.password, database: profile.database,
        connectTimeout: 1000, timezone: 'Z', dateStrings: true });
    try {
        const [row] = await connection.query(
            'SELECT DATABASE() AS db, @@port AS port, @@hostname AS hostname, VERSION() AS version',
        );
        assert.equal(row.db, profile.database);
        assert.equal(Number(row.port), 3306);
        assert.equal(row.hostname, info.Config.Hostname);
        assert.match(row.version, /^11\.4\.\d+-MariaDB\b/);
        return connection;
    } catch (error) {
        await connection.end();
        throw error;
    }
}

function startDatabase(database) {
    const profile = newProfile();
    profile.database = database; // Permite reproducir el mismo DB_NAME en otra instancia.
    profile.id = docker('run', '--rm', '-d', '--name', profile.container,
        '--label', `ferrepatagonia.cc260-test=${profile.token}`,
        '--tmpfs', '/var/lib/mysql:rw', '-p', '127.0.0.1::3306',
        '-e', `MARIADB_ROOT_PASSWORD=${profile.password}`,
        '-e', `MARIADB_DATABASE=${profile.database}`, image);
    const info = JSON.parse(docker('inspect', profile.id))[0];
    profile.port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);
    return profile;
}

function applyFile(profile, file) {
    inspectOwned(profile);
    const result = spawnSync('docker', ['exec', '-i', profile.id, 'mariadb', '--skip-ssl', '-uroot',
        `-p${profile.password}`, profile.database], {
        input: fs.readFileSync(file), encoding: 'utf8', windowsHide: true, timeout: 60000,
    });
    if (result.status !== 0) throw new Error(`SQL ${path.basename(file)}: ${result.stderr || result.error?.message}`);
}

async function waitReady(profile) {
    let lastError;
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const connection = await connectProfile(profile);
            await connection.end();
            return;
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    throw lastError;
}

async function createDatabase(database, { fer20Only = false } = {}) {
    const profile = startDatabase(database);
    try {
        await waitReady(profile);
        applyFile(profile, path.join(backend, '../database/schema.sql'));
        applyFile(profile, path.join(backend, '../database/migrate-fer-20-account-movements.sql'));
        if (!fer20Only) {
            applyFile(profile, path.join(backend, '../database/migrate-fer-17-price-verification.sql'));
            applyFile(profile, path.join(backend, '../database/migrate-s7-04-2-state-consistency.sql'));
        }
        return profile;
    } catch (error) {
        removeDatabase(profile);
        throw error;
    }
}

function removeDatabase(profile) {
    if (!profile?.id) return;
    const info = JSON.parse(docker('inspect', profile.id))[0];
    assert.equal(info.Config.Labels['ferrepatagonia.cc260-test'], profile.token);
    docker('rm', '-f', '-v', profile.id);
    assert.equal(docker('ps', '-aq', '--filter', `label=ferrepatagonia.cc260-test=${profile.token}`), '');
}

module.exports = { startDatabase, createDatabase, removeDatabase, applyFile, waitReady, connectProfile, image };
