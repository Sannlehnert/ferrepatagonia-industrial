// T-S7-01.2: la utilidad de almacenamiento valida TODO antes de mutar, detecta
// solapamientos por pares y enlaces en cualquier componente, y no relaja 0700.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const backend = path.resolve(__dirname, '..');
const script = path.join(backend, 'scripts/prepare-local-storage.cjs');
const missingDotenv = path.join(os.tmpdir(), 'ferrepatagonia-test-no-dotenv.env');
const isWindows = process.platform === 'win32';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function tempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ferre-storage-test-'));
}

function paths(root) {
    return {
        product: path.join(root, 'fotos-productos'),
        receipt: path.join(root, 'comprobantes'),
        import: path.join(root, 'importaciones'),
    };
}

function run(env, args = []) {
    const clean = { ...process.env };
    for (const key of ['PRODUCT_IMAGE_STORAGE_DIR', 'RECEIPT_STORAGE_DIR', 'IMPORT_STORAGE_DIR']) delete clean[key];
    return spawnSync(process.execPath, [script, ...args], {
        cwd: backend,
        env: { ...clean, NODE_ENV: 'test', DOTENV_CONFIG_PATH: missingDotenv, ...env },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
    });
}

function envFor(dirs) {
    return {
        PRODUCT_IMAGE_STORAGE_DIR: dirs.product,
        RECEIPT_STORAGE_DIR: dirs.receipt,
        IMPORT_STORAGE_DIR: dirs.import,
    };
}

function remove(root) {
    fs.rmSync(root, { recursive: true, force: true });
}

function assertNothingCreated(dirs) {
    for (const value of Object.values(dirs)) assert.equal(fs.existsSync(value), false, `No debe crearse ${value}`);
}

test('inspeccion no muta y --apply crea los tres directorios separados', () => {
    const root = tempRoot();
    try {
        const dirs = paths(root);
        const inspection = run(envFor(dirs));
        assert.equal(inspection.status, 1, 'La inspeccion informa pendientes sin crearlos');
        assert.match(inspection.stdout, /CREAR/);
        assertNothingCreated(dirs);

        const applied = run(envFor(dirs), ['--apply']);
        assert.equal(applied.status, 0, applied.stderr);
        for (const value of Object.values(dirs)) assert.equal(fs.statSync(value).isDirectory(), true);
        if (!isWindows) {
            for (const value of Object.values(dirs)) assert.equal(fs.statSync(value).mode & 0o777, 0o700);
        }
    } finally {
        remove(root);
    }
});

test('una configuracion global invalida cancela --apply sin crear ningun directorio', () => {
    const root = tempRoot();
    try {
        const dirs = paths(root);
        const relative = path.join('tmp-relativo-' + path.basename(root), 'fotos');
        const applied = run({
            PRODUCT_IMAGE_STORAGE_DIR: relative,
            RECEIPT_STORAGE_DIR: dirs.receipt,
            IMPORT_STORAGE_DIR: dirs.import,
        }, ['--apply']);
        assert.equal(applied.status, 1);
        assert.match(applied.stderr, /no se creo ni modifico ningun directorio/i);
        assert.equal(fs.existsSync(path.join(backend, relative)), false);
        assertNothingCreated(dirs);
    } finally {
        remove(root);
    }
});

test('rechaza directorios iguales y contenidos entre si (pares)', () => {
    const cases = [
        root => {
            const dirs = paths(root);
            return { PRODUCT_IMAGE_STORAGE_DIR: dirs.product, RECEIPT_STORAGE_DIR: dirs.product, IMPORT_STORAGE_DIR: dirs.import };
        },
        root => {
            const dirs = paths(root);
            return { PRODUCT_IMAGE_STORAGE_DIR: dirs.product, RECEIPT_STORAGE_DIR: path.join(dirs.product, 'comprobantes'),
                IMPORT_STORAGE_DIR: dirs.import };
        },
        root => {
            const dirs = paths(root);
            return { PRODUCT_IMAGE_STORAGE_DIR: dirs.product, RECEIPT_STORAGE_DIR: dirs.receipt,
                IMPORT_STORAGE_DIR: path.join(dirs.receipt, 'importaciones') };
        },
        root => {
            const dirs = paths(root);
            return { PRODUCT_IMAGE_STORAGE_DIR: dirs.product, RECEIPT_STORAGE_DIR: path.join(dirs.import, 'comprobantes'),
                IMPORT_STORAGE_DIR: dirs.import };
        },
    ];
    for (const build of cases) {
        const root = tempRoot();
        try {
            const env = build(root);
            const applied = run(env, ['--apply']);
            assert.equal(applied.status, 1);
            assert.match(applied.stderr, /no se creo ni modifico ningun directorio/i);
            for (const value of Object.values(env)) assert.equal(fs.existsSync(value), false);
        } finally {
            remove(root);
        }
    }
});

test('IMPORT dentro de RECEIPT y RECEIPT dentro de IMPORT son rechazados sin mutar', () => {
    const root = tempRoot();
    try {
        const base = paths(root);
        const combinations = [
            { PRODUCT_IMAGE_STORAGE_DIR: base.product, RECEIPT_STORAGE_DIR: base.receipt,
                IMPORT_STORAGE_DIR: path.join(base.receipt, 'import') },
            { PRODUCT_IMAGE_STORAGE_DIR: base.product, IMPORT_STORAGE_DIR: base.import,
                RECEIPT_STORAGE_DIR: path.join(base.import, 'receipt') },
        ];
        for (const env of combinations) {
            const result = run(env, ['--apply']);
            assert.equal(result.status, 1);
            assert.match(result.stdout, /INVALIDA/);
            for (const value of Object.values(env)) assert.equal(fs.existsSync(value), false);
        }
    } finally {
        remove(root);
    }
});

test('rechaza enlaces simbolicos en el directorio final y en un ancestro sin crear fuera', () => {
    const root = tempRoot();
    try {
        const outside = path.join(root, 'fuera');
        fs.mkdirSync(outside, { recursive: true });
        const link = path.join(root, 'enlace');
        fs.symlinkSync(outside, link, isWindows ? 'junction' : 'dir');

        const finalLink = run({
            PRODUCT_IMAGE_STORAGE_DIR: link,
            RECEIPT_STORAGE_DIR: path.join(root, 'comprobantes'),
            IMPORT_STORAGE_DIR: path.join(root, 'importaciones'),
        }, ['--apply']);
        assert.equal(finalLink.status, 1);
        assert.match(finalLink.stdout, /INVALIDA/);
        assert.equal(fs.existsSync(path.join(root, 'comprobantes')), false);
        assert.equal(fs.existsSync(path.join(root, 'importaciones')), false);

        const ancestor = run({
            PRODUCT_IMAGE_STORAGE_DIR: path.join(link, 'fotos'),
            RECEIPT_STORAGE_DIR: path.join(root, 'comprobantes'),
            IMPORT_STORAGE_DIR: path.join(root, 'importaciones'),
        }, ['--apply']);
        assert.equal(ancestor.status, 1);
        assert.match(ancestor.stdout, /INVALIDA/);
        assert.equal(fs.existsSync(path.join(outside, 'fotos')), false);
        assert.equal(fs.existsSync(path.join(root, 'comprobantes')), false);
        assert.equal(fs.existsSync(path.join(root, 'importaciones')), false);
    } finally {
        remove(root);
    }
});

test('permisos POSIX: comprobantes 0700, no relaja 0700 y corrige permisos amplios', { skip: isWindows }, () => {
    const root = tempRoot();
    try {
        const dirs = paths(root);
        for (const value of Object.values(dirs)) fs.mkdirSync(value, { recursive: true, mode: 0o700 });
        fs.chmodSync(dirs.product, 0o700);
        fs.chmodSync(dirs.receipt, 0o755);
        fs.chmodSync(dirs.import, 0o777);
        fs.writeFileSync(path.join(dirs.product, 'marca.txt'), 'persistente');
        fs.writeFileSync(path.join(dirs.receipt, 'marca.txt'), 'privado');

        const applied = run(envFor(dirs), ['--apply']);
        assert.equal(applied.status, 0, applied.stderr);
        assert.equal(fs.statSync(dirs.product).mode & 0o777, 0o700, 'No se relaja 0700');
        assert.equal(fs.statSync(dirs.receipt).mode & 0o777, 0o700, 'Comprobantes privados');
        assert.equal(fs.statSync(dirs.import).mode & 0o777, 0o700, 'Se corrigen permisos amplios');
        assert.equal(fs.readFileSync(path.join(dirs.product, 'marca.txt'), 'utf8'), 'persistente');
        assert.equal(fs.readFileSync(path.join(dirs.receipt, 'marca.txt'), 'utf8'), 'privado');

        const again = run(envFor(dirs), ['--apply']);
        assert.equal(again.status, 0, again.stderr);
        assert.match(again.stdout, /Almacenamiento verificado/);
        assert.equal(fs.statSync(dirs.receipt).mode & 0o777, 0o700);
    } finally {
        remove(root);
    }
});

test('permisos mas restrictivos pero operativos se conservan', { skip: isWindows || isRoot }, () => {
    const root = tempRoot();
    try {
        const dirs = paths(root);
        for (const value of Object.values(dirs)) fs.mkdirSync(value, { recursive: true, mode: 0o700 });
        fs.chmodSync(dirs.product, 0o750);
        fs.chmodSync(dirs.receipt, 0o700);
        fs.chmodSync(dirs.import, 0o700);
        const applied = run(envFor(dirs), ['--apply']);
        assert.equal(applied.status, 0, applied.stderr);
        assert.equal(fs.statSync(dirs.product).mode & 0o777, 0o750);
        assert.equal(fs.statSync(dirs.receipt).mode & 0o777, 0o700);
    } finally {
        remove(root);
    }
});

test('corrige permisos sin escritura en comprobantes', { skip: isWindows || isRoot }, () => {
    const root = tempRoot();
    try {
        const dirs = paths(root);
        for (const value of Object.values(dirs)) fs.mkdirSync(value, { recursive: true, mode: 0o700 });
        fs.chmodSync(dirs.receipt, 0o500);
        const applied = run(envFor(dirs), ['--apply']);
        assert.equal(applied.status, 0, applied.stderr);
        assert.equal(fs.statSync(dirs.receipt).mode & 0o777, 0o700);
    } finally {
        remove(root);
    }
});

test('rechaza rutas relativas, con espacios y NUL sin mutar', () => {
    const root = tempRoot();
    try {
        const dirs = paths(root);
        const clean = { ...process.env };
        for (const key of ['PRODUCT_IMAGE_STORAGE_DIR', 'RECEIPT_STORAGE_DIR', 'IMPORT_STORAGE_DIR']) delete clean[key];
        const baseEnv = { ...clean, NODE_ENV: 'test', DOTENV_CONFIG_PATH: missingDotenv,
            RECEIPT_STORAGE_DIR: dirs.receipt, IMPORT_STORAGE_DIR: dirs.import };
        const results = [
            run({ PRODUCT_IMAGE_STORAGE_DIR: 'fotos', RECEIPT_STORAGE_DIR: dirs.receipt, IMPORT_STORAGE_DIR: dirs.import }, ['--apply']),
            run({ PRODUCT_IMAGE_STORAGE_DIR: ' ' + dirs.product, RECEIPT_STORAGE_DIR: dirs.receipt, IMPORT_STORAGE_DIR: dirs.import }, ['--apply']),
            // Un NUL no puede viajar por el entorno del sistema: se inyecta en un
            // proceso hijo que carga el script, igual que lo veria el script.
            spawnSync(process.execPath, ['-e',
                `process.env = { ...process.env, PRODUCT_IMAGE_STORAGE_DIR: ${JSON.stringify(dirs.product + '\0x')} };` +
                `process.argv = [process.execPath, ${JSON.stringify(script)}, '--apply'];` +
                `require(${JSON.stringify(script)});`],
            { cwd: backend, env: baseEnv, encoding: 'utf8', windowsHide: true, timeout: 30000 }),
        ];
        for (const result of results) {
            assert.equal(result.status, 1);
            assert.match(result.stderr, /no se creo ni modifico ningun directorio/i);
        }
        assertNothingCreated(dirs);
        assert.equal(fs.existsSync(path.join(backend, 'fotos')), false);
    } finally {
        remove(root);
    }
});
