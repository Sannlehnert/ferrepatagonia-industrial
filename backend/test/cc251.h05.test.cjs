const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const { label, newProfile } = require('./helpers/cc260-disposable.cjs');

const containerId = 'a'.repeat(64);
const port = 49152;

function load(file, localProcess, overrides, localConsole = console) {
    const filename = path.join(__dirname, file);
    const module = { exports: {} };
    const localRequire = createRequire(filename);
    const execute = compileFunction(fs.readFileSync(filename, 'utf8'),
        ['module', 'require', 'process', 'console', '__dirname'], { filename });
    execute(module, id => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id),
        localProcess, localConsole, path.dirname(filename));
    return module.exports;
}

function inspection(profile, runner = 251) {
    const [key, value] = label(profile, runner).split('=');
    return {
        Id: profile.id,
        Name: `/${profile.container}`,
        Config: {
            Image: 'mariadb:11.4', Hostname: profile.id.slice(0, 12), Labels: { [key]: value },
            Env: [`MARIADB_DATABASE=${profile.database}`, `MARIADB_ROOT_PASSWORD=${profile.password}`]
        },
        State: { Running: true },
        HostConfig: {
            AutoRemove: true, Tmpfs: { '/var/lib/mysql': 'rw' },
            PortBindings: { '3306/tcp': [{ HostIp: profile.host, HostPort: '' }] }
        },
        Mounts: [],
        NetworkSettings: { Ports: { '3306/tcp': [{ HostIp: profile.host, HostPort: String(profile.port) }] } }
    };
}

function serverIdentity(profile) {
    return { db: profile.database, port: 3306, hostname: profile.id.slice(0, 12), version: '11.4.12-MariaDB' };
}

for (const [name, mutate, probeCount = 0] of [
    ['perfil ausente aunque haya ALLOW_DEV_DB y nombre temporal', ({ env }) => {
        delete env.CC251_TEST_PROFILE;
        env.ALLOW_DEV_DB = 'true';
        env.CUENTA_CORRIENTE_CLIENT_TEST_DATABASE = env.DB_NAME;
    }],
    ['JSON inválido', ({ env }) => { env.CC251_TEST_PROFILE = '{'; }],
    ['perfil #260 con solo database', ({ env }) => {
        delete env.CC251_TEST_PROFILE;
        env.CC260_TEST_PROFILE = JSON.stringify({ database: env.DB_NAME });
    }],
    ['ferrepatagonia_dev aunque coincida con DB_NAME', ({ env, profile }) => {
        profile.database = env.DB_NAME = 'ferrepatagonia_dev';
        env.CC251_TEST_PROFILE = JSON.stringify(profile);
    }],
    ['puerto alternativo sin identidad acreditada', ({ info }) => { info.Id = undefined; }],
    ['puerto diferente del publicado', ({ info }) => {
        info.NetworkSettings.Ports['3306/tcp'][0].HostPort = '49153';
    }],
    ['puerto fijado manualmente', ({ info }) => { info.HostConfig.PortBindings['3306/tcp'][0].HostPort = String(port); }],
    ['token incorrecto', ({ env, profile }) => {
        env.CC251_TEST_PROFILE = JSON.stringify({ ...profile, token: 'b'.repeat(32) });
    }],
    ['ID incorrecto', ({ info }) => { info.Id = 'b'.repeat(64); }],
    ['label incorrecto', ({ info }) => { info.Config.Labels['ferrepatagonia.cc251-test'] = 'otro'; }],
    ['host no loopback', ({ env, profile }) => {
        profile.host = env.DB_HOST = 'db.example.com';
        env.CC251_TEST_PROFILE = JSON.stringify(profile);
    }],
    ['contenedor distinto', ({ info }) => { info.Name = '/contenedor-ajeno'; }],
    ['imagen incorrecta', ({ info }) => { info.Config.Image = 'mariadb:latest'; }],
    ['sin tmpfs', ({ info }) => { info.HostConfig.Tmpfs = {}; }],
    ['volumen persistente', ({ info }) => { info.Mounts = [{ Type: 'volume' }]; }],
    ['bind persistente', ({ info }) => { info.Mounts = [{ Type: 'bind' }]; }],
    ['sin AutoRemove', ({ info }) => { info.HostConfig.AutoRemove = false; }],
    ['credenciales del proceso diferentes', ({ env }) => { env.DB_PASSWORD = 'ajena'; }],
    ['base efectiva distinta', ({ row }) => { row.db = 'ferrepatagonia_dev'; }, 1],
    ['servidor efectivo distinto', ({ row }) => { row.hostname = 'ajeno'; }, 1],
    ['versión efectiva distinta', ({ row }) => { row.version = '11.8.2-MariaDB'; }, 1],
    ['DataSource configurado para otra base', ({ options }) => { options.database = 'ferrepatagonia_dev'; }, 1],
]) {
    test(`rechaza antes de DataSource.initialize(): ${name}`, async () => {
        const profile = { ...newProfile(251), id: containerId, port };
        const info = inspection(profile);
        const row = serverIdentity(profile);
        const options = { ...profile, username: 'root' };
        const env = {
            NODE_ENV: 'test', DB_HOST: profile.host, DB_PORT: String(port), DB_NAME: profile.database,
            DB_USER: 'root', DB_PASSWORD: profile.password, CC251_TEST_PROFILE: JSON.stringify(profile)
        };
        mutate({ env, profile, info, row, options });

        const localProcess = { env };
        let connected = 0;
        let initialized = 0;
        let ended = 0;
        const helper = load('helpers/cc260-disposable.cjs', localProcess, {
            'node:child_process': {
                execFileSync(command, args) {
                    assert.equal(command, 'docker');
                    assert.deepEqual(args, ['inspect', '--type', 'container', containerId]);
                    return JSON.stringify([info]);
                }
            },
            mariadb: {
                async createConnection() {
                    connected++;
                    return { query: async () => [row], end: async () => { ended++; } };
                }
            }
        });

        let before;
        load('cuentaCorriente.client.test.cjs', localProcess, {
            'node:test': { describe: (_, callback) => callback(), test() {}, before: hook => { before = hook; }, after() {} },
            './helpers/cc260-disposable.cjs': helper,
            '../dist/config/database.config': { dataSource: { options, initialize() { initialized++; } } },
            '../dist/app': {},
            '../dist/config/env.config': {},
            '../dist/services/cuentaCorriente.service': {},
            '../dist/repositories/cuentaCorriente.repository': {}
        });
        await assert.rejects(before);
        assert.equal(initialized, 0);
        assert.equal(connected, probeCount);
        assert.equal(ended, probeCount);
    });
}

function simulateRunner({
    lostRun = false, foreign = false, closeFails = false, suiteCode = 0,
    sqlFailure = 0, interrupt = false, removeFails = false
} = {}) {
    const localProcess = Object.assign(new EventEmitter(), { env: {}, execPath: process.execPath });
    const calls = [];
    const messages = [];
    let resource;
    let profile;
    let sqlCalls = 0;
    const childProcess = {
        execFileSync(command, [action, ...args]) {
            assert.equal(command, 'docker');
            calls.push(action);
            switch (action) {
                case 'run': {
                    const container = args[args.indexOf('--name') + 1];
                    profile = {
                        id: containerId, port, container, host: '127.0.0.1', token: container.slice(-32),
                        database: args.find(arg => arg.startsWith('MARIADB_DATABASE=')).split('=')[1],
                        password: args.find(arg => arg.startsWith('MARIADB_ROOT_PASSWORD=')).split('=')[1]
                    };
                    assert.equal(args[args.indexOf('--label') + 1], label(profile, 251));
                    assert.equal(args[args.indexOf('--tmpfs') + 1], '/var/lib/mysql:rw');
                    resource = inspection(profile);
                    if (foreign) resource.Config.Labels = {};
                    if (lostRun) throw new Error('respuesta de docker run perdida');
                    return containerId;
                }
                case 'ps':
                    assert.ok([`id=${containerId}`, `name=^/${profile.container}$`].includes(args.at(-1)));
                    return resource ? resource.Id : '';
                case 'inspect':
                    assert.deepEqual(args, ['--type', 'container', containerId]);
                    return JSON.stringify([resource]);
                case 'exec':
                    assert.equal(args[1], containerId);
                    if (++sqlCalls === sqlFailure) throw new Error('SQL de prueba falló');
                    return '';
                case 'rm':
                    assert.equal(calls.at(-2), 'inspect', 'Debe inspeccionar antes de eliminar');
                    assert.deepEqual(args, ['-f', '-v', containerId]);
                    if (removeFails) throw new Error('Docker rechazó rm');
                    resource = undefined;
                    return '';
                default:
                    assert.fail(`Docker inesperado: ${action}`);
            }
        },
        spawn() {
            calls.push('spawn');
            const child = new EventEmitter();
            child.kill = signal => {
                calls.push(signal);
                queueMicrotask(() => child.emit('exit', null, signal));
            };
            queueMicrotask(() => {
                if (interrupt) localProcess.emit('SIGTERM', 'SIGTERM');
                else child.emit('exit', suiteCode, null);
            });
            return child;
        }
    };
    const helper = load('helpers/cc260-disposable.cjs', localProcess, {
        'node:child_process': childProcess,
        mariadb: {
            async createConnection() {
                calls.push('connect');
                return {
                    query: async () => [serverIdentity(profile)],
                    async end() {
                        calls.push('end');
                        if (closeFails) throw new Error('connection.end() falló');
                    }
                };
            }
        }
    });
    const { run } = load('helpers/run-cuenta-corriente-client-mariadb.cjs', localProcess, {
        'node:child_process': childProcess,
        './cc260-disposable.cjs': helper
    }, { error: message => messages.push(message) });
    return { run, calls, messages, hasContainer: () => Boolean(resource), localProcess };
}

for (const [name, options, code, expected] of [
    ['respuesta de docker run perdida', { lostRun: true }, 1, [/respuesta de docker run perdida/]],
    ['cierre SQL fallido', { closeFails: true }, 1, [/connection.end\(\) falló/]],
    ['suite fallida', { suiteCode: 7 }, 7, [/Suite #251 falló \(exit 7\)/]],
    ['suite y cierre fallidos', { suiteCode: 7, closeFails: true }, 7,
        [/Suite #251 falló \(exit 7\)/, /connection.end\(\) falló/]],
    ['inicialización SQL fallida', { sqlFailure: 1 }, 1, [/SQL de prueba falló/]],
    ['migración SQL fallida', { sqlFailure: 2 }, 1, [/SQL de prueba falló/]],
    ['SIGTERM durante la suite', { interrupt: true }, 1, [/Suite #251 interrumpida \(SIGTERM\)/]],
]) {
    test(`limpia el contenedor propio ante ${name}`, async () => {
        const { run, calls, messages, hasContainer, localProcess } = simulateRunner(options);
        assert.equal(await run(), code);
        assert.equal(hasContainer(), false);
        assert.equal(calls.filter(call => call === 'rm').length, 1);
        if (options.lostRun) assert.ok(!calls.includes('connect'));
        else assert.ok(calls.indexOf('end') < calls.indexOf('rm'));
        if (options.sqlFailure) assert.ok(!calls.includes('spawn'));
        if (options.interrupt) assert.ok(calls.indexOf('SIGTERM') < calls.indexOf('rm'));
        assert.equal(localProcess.listenerCount('SIGTERM'), 0);
        assert.equal(messages.length, expected.length);
        for (const [index, pattern] of expected.entries()) assert.match(messages[index], pattern);
    });
}

test('rechaza limpiar un contenedor ajeno con el mismo nombre', async () => {
    const { run, calls, messages, hasContainer } = simulateRunner({ lostRun: true, foreign: true });
    assert.equal(await run(), 1);
    assert.equal(hasContainer(), true);
    assert.ok(!calls.includes('rm'));
    assert.match(messages.join('\n'), /El contenedor no pertenece al runner/);
});

test('reporta un fallo de Docker al eliminar el contenedor', async () => {
    const { run, messages, hasContainer } = simulateRunner({ removeFails: true });
    assert.equal(await run(), 1);
    assert.equal(hasContainer(), true);
    assert.match(messages.join('\n'), /Limpieza de Docker #251: Docker rechazó rm/);
});
