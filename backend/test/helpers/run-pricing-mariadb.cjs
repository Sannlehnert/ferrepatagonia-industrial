const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
const assert = require('node:assert/strict');
const backend = path.resolve(__dirname, '../..');
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
    const schema = fs.readFileSync(path.join(backend, '../database/schema.sql'),'utf8');
    // Start with #240 schema only, so #241 is tested as a real additive upgrade.
    for (const statement of schema.split('-- #241:')[0].split(';').filter(s=>s.trim())) await connection.query(statement);
    // Execute Lucci's migration unchanged, using its existing delimiter wrapper.
    const migration = fs.readFileSync(path.join(backend,'../database/migrate-fer-17-price-lists.sql'),'utf8')
      .replace(/^SET NAMES\s+\S+;\s*$/gim,'').replace(/^DELIMITER\s+\S+\s*$/gim,'').replace(/END\s*\/\//g,'END;').trim();
    await connection.query(migration);
    await connection.query("INSERT INTO CATEGORIA(id_categoria,nombre,activo) VALUES(990,'legacy-migration-probe',1)");
    await connection.query("INSERT INTO PRODUCTO(id_producto,id_categoria,codigo,nombre,precio,stock,activo) VALUES(991,990,'legacy-probe','legacy',173.12,1,1)");
    const extension=fs.readFileSync(path.join(backend,'../database/migrate-fer-17-pricing-evidence.sql'),'utf8');
    for(let n=0;n<2;n++) for(const sql of extension.split(';').filter(s=>s.trim())) await connection.query(sql);
    // Complete the current official schema after the #240 -> #241 upgrade probe.
    // Every statement after the #241 marker is CREATE TABLE IF NOT EXISTS.
    for(const sql of schema.slice(schema.indexOf('-- #241:')).split(';').filter(s=>s.trim())) await connection.query(sql);
    const [legacy]=await connection.query('SELECT precio FROM PRODUCTO WHERE id_producto=991');
    assert.equal(legacy.precio,'173.12');
    assert.equal(Number((await connection.query('SELECT COUNT(*) AS n FROM PRECIO_USD_EVIDENCIA'))[0].n),0);
    console.log('Migration #241 twice: legacy 173.12 preserved, no USD evidence fabricated.');
    // The official clean install also requires the FER-20 guards and three triggers.
    const fer20=path.join(backend,'../database/migrate-fer-20-account-movements.sql');
    const applyFer20=()=>{
      const result=spawnSync('docker',['exec','-i',container,'mariadb','-uroot',`-p${password}`,database],
        {input:fs.readFileSync(fer20),encoding:'utf8',windowsHide:true,timeout:120000});
      if(result.status!==0)throw Error(`SQL ${path.basename(fer20)}: ${result.stderr}`);
    };
    applyFer20();applyFer20();
    const [schemaState]=await connection.query(`SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()) AS tables,
      (SELECT GROUP_CONCAT(TRIGGER_NAME ORDER BY TRIGGER_NAME) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) AS triggers`);
    assert.equal(Number(schemaState.tables),21);
    assert.equal(schemaState.triggers,'fer260_cuenta_revision,fer260_imputacion_insert,fer260_imputacion_update');
    assert.match((await connection.query('SELECT VERSION() AS v'))[0].v,/^11\.4\.\d+-MariaDB\b/);
    console.log('Clean install: 21 tables + 3 FER-20 triggers verified twice.');
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
main().catch(error=>{console.error(error.message);process.exitCode=1;});
