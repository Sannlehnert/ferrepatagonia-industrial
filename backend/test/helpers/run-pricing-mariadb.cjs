const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
const assert = require('node:assert/strict');
const { applySql } = require('./mariadb-cli.cjs');

const backend = path.resolve(__dirname, '../..');
const databaseDir = path.join(backend, '../database');
const token = randomUUID().replaceAll('-', '');
const database = `pricing_test_${token}`;
const container = `pricing-test-${token}`;
const password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim();

async function main() {
  let started = false, connection;
  try {
    docker('run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::3306',
      '-e', `MARIADB_ROOT_PASSWORD=${password}`, '-e', `MARIADB_DATABASE=${database}`, 'mariadb:11.4');
    started = true;
    const info = JSON.parse(docker('inspect', container))[0];
    const port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);
    for (let i = 0; i < 60; i++) {
      try { connection = await mariadb.createConnection({ host:'127.0.0.1', port, user:'root', password, database, connectTimeout:1000 }); break; }
      catch { await new Promise(resolve => setTimeout(resolve,1000)); }
    }
    if (!connection) throw Error('MariaDB desechable no disponible');

    const apply = file => applySql({
      container, password, database, sql: fs.readFileSync(path.join(databaseDir, file)),
    });

    // Start with #240 schema only, so #241 is tested as a real additive upgrade.
    const schema = fs.readFileSync(path.join(databaseDir, 'schema.sql'), 'utf8');
    applySql({ container, password, database, sql: schema.split('-- #241:')[0] });

    // Execute FER-17 migrations unchanged through the container's MariaDB client.
    apply('migrate-fer-17-price-lists.sql');
    await connection.query("INSERT INTO CATEGORIA(id_categoria,nombre,activo) VALUES(990,'legacy-migration-probe',1)");
    await connection.query("INSERT INTO PRODUCTO(id_producto,id_categoria,codigo,nombre,precio,stock,activo) VALUES(991,990,'legacy-probe','legacy',173.12,1,1)");

    // 1. Verificar upgrade incremental FER-17 (dos aplicaciones) sin fabricar evidencia
    apply('migrate-fer-17-pricing-evidence.sql');
    apply('migrate-fer-17-pricing-evidence.sql');
    apply('migrate-fer-17-price-verification.sql');
    apply('migrate-fer-17-price-verification.sql');

    const [legacy] = await connection.query('SELECT precio FROM PRODUCTO WHERE id_producto=991');
    assert.equal(legacy.precio, '173.12');
    assert.equal(Number((await connection.query('SELECT COUNT(*) AS n FROM PRECIO_USD_EVIDENCIA'))[0].n), 0);
    assert.equal(Number((await connection.query('SELECT COUNT(*) AS n FROM FER17_PRECIO_EVENTO'))[0].n), 0);
    console.log('FER-17 migrations applied twice: legacy 173.12 preserved, no USD evidence fabricated.');

    // 2. Completar el resto del esquema oficial posterior a #241 y guardas FER-20
    applySql({
      container,
      password,
      database,
      sql: schema.slice(schema.indexOf('-- #241:')),
    });
    apply('migrate-fer-20-account-movements.sql');
    apply('migrate-fer-20-account-movements.sql');

    // 3. Verificar estado final de instalación limpia: 22 tablas y 5 triggers (3 FER-20 + 2 FER-17)
    const [schemaState] = await connection.query(`SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()) AS tables,
      (SELECT GROUP_CONCAT(TRIGGER_NAME ORDER BY TRIGGER_NAME) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) AS triggers`);
    assert.equal(Number(schemaState.tables), 22);
    assert.equal(
      schemaState.triggers,
      'fer17_producto_alta_evento,fer17_producto_precio_evento,fer260_cuenta_revision,fer260_imputacion_insert,fer260_imputacion_update',
    );
    assert.match((await connection.query('SELECT VERSION() AS v'))[0].v, /^11\.4\.\d+-MariaDB\b/);
    console.log('Clean install: 22 tables + 5 triggers (3 FER-20 + 2 FER-17) verified twice.');

    const result = spawnSync(process.execPath,['--require','./test/helpers/test-env.cjs','--test','--test-concurrency=1','test/pricing.mariadb.test.cjs'],{
      cwd:backend,stdio:'inherit',env:{...process.env,DOTENV_CONFIG_PATH:path.join(backend,'test/helpers/nonexistent.env'),
        JWT_SECRET:randomUUID(),DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_NAME:database,DB_USER:'root',DB_PASSWORD:password,
        PRICING_TEST_DATABASE:database},
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === 0 ? 0 : 1;
  } finally {
    try { if (connection) await connection.end(); }
    finally { if (started) docker('rm','-f','-v',container); }
  }
}
main().catch(error=>{console.error(error.stderr?.toString?.().trim() || error.message);process.exitCode=1;});