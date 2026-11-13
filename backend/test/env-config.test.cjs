const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const backendDir = path.resolve(__dirname, '..');
const nonexistentEnvPath = path.join(os.tmpdir(), 'ferrepatagonia-nonexistent.env');

const testSecret = () => randomBytes(32).toString('hex');

const baseDevEnv = (overrides = {}) => ({
  NODE_ENV: 'development',
  DB_HOST: '127.0.0.1',
  DB_NAME: 'ferrepatagonia_test',
  DB_USER: 'tester',
  DB_PASSWORD: 'local-test-password',
  JWT_SECRET: testSecret(),
  ...overrides,
});

const baseProdEnv = (overrides = {}) => ({
  NODE_ENV: 'production',
  APP_PUBLIC_ORIGIN: 'https://ferrepatagonia.example.test',
  TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
  HTTPS_TERMINATION: 'trusted-proxy',
  AUTH_RATE_STORE: 'memory',
  API_PROCESS_COUNT: '1',
  AUTH_LOGIN_LIMIT: '20',
  AUTH_LOGIN_WINDOW_MS: '900000',
  AUTH_REGISTER_LIMIT: '10',
  AUTH_REGISTER_WINDOW_MS: '3600000',
  DB_HOST: '127.0.0.1',
  DB_NAME: 'ferrepatagonia_prod',
  DB_USER: 'prod_user',
  DB_PASSWORD: 'prod-secret-password',
  JWT_SECRET: testSecret(),
  ...overrides,
});

// Ensure module-level env load succeeds even when executed outside test-env/dotenv.
Object.assign(process.env, {
  NODE_ENV: process.env.NODE_ENV || 'test',
  APP_PUBLIC_ORIGIN: process.env.APP_PUBLIC_ORIGIN || 'http://browser.test',
  TRUSTED_PROXY_CIDRS: process.env.TRUSTED_PROXY_CIDRS || 'none',
  AUTH_RATE_STORE: process.env.AUTH_RATE_STORE || 'memory',
  API_PROCESS_COUNT: process.env.API_PROCESS_COUNT || '1',
  AUTH_LOGIN_LIMIT: process.env.AUTH_LOGIN_LIMIT || '100000',
  AUTH_LOGIN_WINDOW_MS: process.env.AUTH_LOGIN_WINDOW_MS || '60000',
  AUTH_REGISTER_LIMIT: process.env.AUTH_REGISTER_LIMIT || '100000',
  AUTH_REGISTER_WINDOW_MS: process.env.AUTH_REGISTER_WINDOW_MS || '60000',
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_NAME: process.env.DB_NAME || 'unit',
  DB_USER: process.env.DB_USER || 'unit',
  DB_PASSWORD: process.env.DB_PASSWORD || 'unit',
  JWT_SECRET: process.env.JWT_SECRET || testSecret(),
});

const { loadEnv } = require('../dist/config/env.config');
const { loadHttpSecurity, validateJwtSecret } = require('../dist/config/http-security.config');
const { loadStorageConfig, readStorageDir } = require('../dist/config/storage-env.config');
const { persistRecordToDisk } = require('../dist/utils/importConfirmationState.util');

test('Joi env: aplica valores predeterminados válidos en desarrollo sin storage configurado', () => {
  const cfg = loadEnv(baseDevEnv());
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.db.port, 3307);
  assert.equal(cfg.legacyOrderOffset, '+00:00');
  assert.equal(cfg.httpSecurity.mode, 'development');
  assert.equal(cfg.httpSecurity.publicOrigin, 'http://localhost:5173');
  assert.equal(cfg.httpSecurity.trustedProxies, false);
  assert.equal(cfg.httpSecurity.requireHttps, false);
  assert.deepEqual(cfg.httpSecurity.rate, {
    loginLimit: 20,
    loginWindowMs: 900000,
    registerLimit: 10,
    registerWindowMs: 3600000,
  });
  assert.deepEqual(cfg.storage, {
    productImages: undefined,
    receipts: undefined,
    imports: undefined,
  });
});

test('Joi env: acepta configuración válida personalizada y rutas absolutas opcionales', () => {
  const absFotos = path.resolve(os.tmpdir(), 'ferre-fotos');
  const absRecibos = path.resolve(os.tmpdir(), 'ferre-recibos');
  const absImport = path.resolve(os.tmpdir(), 'ferre-import');
  const cfg = loadEnv(
    baseDevEnv({
      NODE_ENV: 'test',
      PORT: '4100',
      DB_PORT: '3308',
      LEGACY_ORDER_UTC_OFFSET: '-03:00',
      PRODUCT_IMAGE_STORAGE_DIR: absFotos,
      RECEIPT_STORAGE_DIR: absRecibos,
      IMPORT_STORAGE_DIR: absImport,
    }),
  );
  assert.equal(cfg.port, 4100);
  assert.equal(cfg.db.port, 3308);
  assert.equal(cfg.legacyOrderOffset, '-03:00');
  assert.deepEqual(cfg.storage, {
    productImages: absFotos,
    receipts: absRecibos,
    imports: absImport,
  });
});

test('Joi env: valida configuración completa de producción', () => {
  const cfg = loadEnv(baseProdEnv({ PORT: '8080', DB_PORT: '3306' }));
  assert.equal(cfg.httpSecurity.mode, 'production');
  assert.equal(cfg.httpSecurity.requireHttps, true);
  assert.deepEqual(cfg.httpSecurity.trustedProxies, ['127.0.0.1/32']);
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.db.port, 3306);
});

for (const requiredKey of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET']) {
  for (const [label, mutator] of [
    ['ausente', env => { delete env[requiredKey]; }],
    ['vacío', env => { env[requiredKey] = ''; }],
    ['solo espacios', env => { env[requiredKey] = '   '; }],
  ]) {
    test(`Joi env: rechaza ${requiredKey} ${label}`, () => {
      const candidate = baseDevEnv();
      mutator(candidate);
      assert.throws(
        () => loadEnv(candidate),
        err => err instanceof Error && err.message.includes(`Falta ${requiredKey}`),
      );
    });
  }
}

for (const portKey of ['PORT', 'DB_PORT']) {
  for (const badPort of ['', '0', '65536', '-1', '3000.5', '03000', 'abc', ' 3000']) {
    test(`Joi env: rechaza ${portKey} inválido (${JSON.stringify(badPort)})`, () => {
      assert.throws(
        () => loadEnv(baseDevEnv({ [portKey]: badPort })),
        err => err instanceof Error && err.message === `${portKey} debe ser un puerto entre 1 y 65535.`,
      );
    });
  }
}

for (const badMode of [undefined, '', 'production ', 'Production', 'staging']) {
  test(`Joi http: rechaza NODE_ENV inválido (${JSON.stringify(badMode)})`, () => {
    const raw = baseDevEnv();
    if (badMode === undefined) delete raw.NODE_ENV;
    else raw.NODE_ENV = badMode;
    assert.throws(
      () => loadEnv(raw),
      err => err instanceof Error && err.message === 'Configuración inválida: NODE_ENV.',
    );
  });
}

test('Joi env: rechaza LEGACY_ORDER_UTC_OFFSET inválido', () => {
  for (const offset of ['', '+14:01', '-15:00', 'UTC', '-03:00 ']) {
    assert.throws(
      () => loadEnv(baseDevEnv({ LEGACY_ORDER_UTC_OFFSET: offset })),
      err =>
        err instanceof Error &&
        err.message === 'LEGACY_ORDER_UTC_OFFSET debe indicar el desplazamiento histórico respecto de UTC.',
    );
  }
});

test('Joi http: rechaza configuración HTTP inválida en producción y desarrollo', () => {
  for (const [label, overrides] of [
    ['origen HTTP en producción', { APP_PUBLIC_ORIGIN: 'http://ferrepatagonia.example.test' }],
    ['TRUSTED_PROXY_CIDRS=none en producción', { TRUSTED_PROXY_CIDRS: 'none' }],
    ['TRUSTED_PROXY_CIDRS malformado', { TRUSTED_PROXY_CIDRS: '127.0.0.1/99' }],
    ['HTTPS_TERMINATION ausente en producción', { HTTPS_TERMINATION: undefined }],
    ['HTTPS_TERMINATION inválido', { HTTPS_TERMINATION: 'direct' }],
    ['AUTH_RATE_STORE distinto de memory', { AUTH_RATE_STORE: 'redis' }],
    ['API_PROCESS_COUNT distinto de 1', { API_PROCESS_COUNT: '2' }],
    ['AUTH_LOGIN_LIMIT con cero a la izquierda', { AUTH_LOGIN_LIMIT: '05' }],
  ]) {
    const raw = baseProdEnv(overrides);
    if (overrides.HTTPS_TERMINATION === undefined) delete raw.HTTPS_TERMINATION;
    assert.throws(() => loadHttpSecurity(raw), Error, `Debió fallar: ${label}`);
  }
});

test('Joi env: rechaza JWT_SECRET inválido en producción y no filtra el valor secreto', () => {
  const weakSecrets = ['corto-y-secreto-unico', 'Z'.repeat(32), ` ${testSecret()}`];
  for (const secret of weakSecrets) {
    assert.throws(
      () => validateJwtSecret(secret, 'production'),
      err =>
        err instanceof Error &&
        err.message === 'Configuración inválida: JWT_SECRET.' &&
        !err.message.includes(secret.trim()),
    );
    assert.throws(
      () => loadEnv(baseProdEnv({ JWT_SECRET: secret })),
      err =>
        err instanceof Error &&
        err.message === 'Configuración inválida: JWT_SECRET.' &&
        !err.message.includes('corto-y-secreto-unico'),
    );
  }
  const whitespaceOnly = ' '.repeat(32);
  assert.throws(
    () => validateJwtSecret(whitespaceOnly, 'production'),
    err => err instanceof Error && err.message === 'Configuración inválida: JWT_SECRET.',
  );
  assert.throws(
    () => loadEnv(baseProdEnv({ JWT_SECRET: whitespaceOnly })),
    err => err instanceof Error && err.message.includes('Falta JWT_SECRET'),
  );
});

test('Joi storage: trata cadenas vacías como no configuradas y rechaza rutas relativas o malformadas', () => {
  const empty = loadStorageConfig({
    PRODUCT_IMAGE_STORAGE_DIR: '',
    RECEIPT_STORAGE_DIR: '',
    IMPORT_STORAGE_DIR: '',
  });
  assert.deepEqual(empty, {
    productImages: undefined,
    receipts: undefined,
    imports: undefined,
  });

  for (const key of ['PRODUCT_IMAGE_STORAGE_DIR', 'RECEIPT_STORAGE_DIR', 'IMPORT_STORAGE_DIR']) {
    for (const badPath of ['relative/dir', './uploads', '   ', ` ${path.resolve(os.tmpdir(), 'x')}`, '/tmp/bad\0dir']) {
      assert.throws(
        () => loadEnv(baseDevEnv({ [key]: badPath })),
        err =>
          err instanceof Error &&
          err.message === `Configuración inválida: ${key}.` &&
          !err.message.includes(badPath),
      );
      assert.throws(
        () => readStorageDir(key, { [key]: badPath }),
        err => err instanceof Error && err.message === `Configuración inválida: ${key}.`,
      );
    }
  }
});

test('Joi storage: readStorageDir refleja mutaciones dinámicas de process.env como en pruebas', () => {
  const prev = process.env.PRODUCT_IMAGE_STORAGE_DIR;
  const dynamicAbs = path.resolve(os.tmpdir(), 'dynamic-product-images');
  try {
    process.env.PRODUCT_IMAGE_STORAGE_DIR = dynamicAbs;
    assert.equal(readStorageDir('PRODUCT_IMAGE_STORAGE_DIR'), dynamicAbs);
    process.env.PRODUCT_IMAGE_STORAGE_DIR = '';
    assert.equal(readStorageDir('PRODUCT_IMAGE_STORAGE_DIR'), undefined);
  } finally {
    if (prev === undefined) delete process.env.PRODUCT_IMAGE_STORAGE_DIR;
    else process.env.PRODUCT_IMAGE_STORAGE_DIR = prev;
  }
});

test('Joi storage: importConfirmationState unifica el fallback en ferrepatagonia-import-storage ante ausencia, vacío o valor inválido posterior', () => {
  const savedEnv = {
    IMPORT_STORAGE_DIR: process.env.IMPORT_STORAGE_DIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
  };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ferre-import-fallback-'));
  const expectedFallbackDir = path.join(tmpRoot, 'ferrepatagonia-import-storage');
  const customDir = path.join(tmpRoot, 'custom-import-dir');

  const persistSample = token => {
    const now = Date.now();
    persistRecordToDisk({
      token,
      createdAtMs: now,
      expiresAtMs: now + 60_000,
      adminId: 1,
      status: 'pendiente',
      rows: [],
      attemptedSkus: new Set(),
      importedProductIds: new Set(),
      batchLinkedProducts: new Map(),
    });
  };

  try {
    process.env.TEMP = tmpRoot;
    process.env.TMP = tmpRoot;
    process.env.TMPDIR = tmpRoot;
    assert.equal(os.tmpdir(), tmpRoot);

    // 1. IMPORT_STORAGE_DIR ausente
    delete process.env.IMPORT_STORAGE_DIR;
    const missingToken = randomUUID();
    persistSample(missingToken);
    assert.equal(fs.existsSync(path.join(expectedFallbackDir, `${missingToken}.json`)), true);
    assert.equal(fs.existsSync(path.join(tmpRoot, `${missingToken}.json`)), false);

    // 2. IMPORT_STORAGE_DIR=''
    process.env.IMPORT_STORAGE_DIR = '';
    const emptyToken = randomUUID();
    persistSample(emptyToken);
    assert.equal(fs.existsSync(path.join(expectedFallbackDir, `${emptyToken}.json`)), true);
    assert.equal(fs.existsSync(path.join(tmpRoot, `${emptyToken}.json`)), false);

    // 3. Modificación posterior a un valor inválido (incluso tras configuración válida y sin existir aún el subdirectorio)
    process.env.IMPORT_STORAGE_DIR = customDir;
    const validToken = randomUUID();
    persistSample(validToken);
    assert.equal(fs.existsSync(path.join(customDir, `${validToken}.json`)), true);

    fs.rmSync(expectedFallbackDir, { recursive: true, force: true });
    process.env.IMPORT_STORAGE_DIR = 'relative/invalid-import-dir';
    const invalidToken = randomUUID();
    persistSample(invalidToken);
    assert.equal(fs.existsSync(path.join(expectedFallbackDir, `${invalidToken}.json`)), true);
    assert.equal(fs.existsSync(path.join(tmpRoot, `${invalidToken}.json`)), false);

    process.env.IMPORT_STORAGE_DIR = '   ';
    const blankInvalidToken = randomUUID();
    persistSample(blankInvalidToken);
    assert.equal(fs.existsSync(path.join(expectedFallbackDir, `${blankInvalidToken}.json`)), true);
    assert.equal(fs.existsSync(path.join(tmpRoot, `${blankInvalidToken}.json`)), false);

    assert.deepEqual(
      fs.readdirSync(tmpRoot).filter(entry => entry.endsWith('.json')),
      [],
    );
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Arranque del servidor rechaza configuración inválida antes de iniciar BD/HTTP y sin filtrar secretos', () => {
  const sensitivePassword = 'SENTINEL_DB_PASSWORD_SECRET_VALUE';
  const weakSentinelSecret = 'SENTINEL_SHORT_JWT_NO_LEAK';

  const missingDbRun = spawnSync(process.execPath, ['dist/server.js'], {
    cwd: backendDir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      DOTENV_CONFIG_PATH: nonexistentEnvPath,
      ...baseDevEnv({
        DB_HOST: '',
        DB_PASSWORD: sensitivePassword,
      }),
    },
  });
  assert.notEqual(missingDbRun.status, 0);
  assert.match(missingDbRun.stderr, /Falta DB_HOST/);
  assert.equal(missingDbRun.stdout, '');
  assert.equal(missingDbRun.stderr.includes(sensitivePassword), false);
  assert.equal(missingDbRun.stderr.includes('No se pudo inicializar la base de datos'), false);

  const invalidProdJwtRun = spawnSync(process.execPath, ['dist/server.js'], {
    cwd: backendDir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      DOTENV_CONFIG_PATH: nonexistentEnvPath,
      ...baseProdEnv({
        JWT_SECRET: weakSentinelSecret,
        DB_PASSWORD: sensitivePassword,
      }),
    },
  });
  assert.notEqual(invalidProdJwtRun.status, 0);
  assert.match(invalidProdJwtRun.stderr, /Configuración inválida: JWT_SECRET\./);
  assert.equal(invalidProdJwtRun.stdout, '');
  assert.equal(invalidProdJwtRun.stderr.includes(weakSentinelSecret), false);
  assert.equal(invalidProdJwtRun.stderr.includes(sensitivePassword), false);
  assert.equal(invalidProdJwtRun.stderr.includes('No se pudo inicializar la base de datos'), false);
});
