const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
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
    for (const statement of schema.split(';').filter(s=>s.trim())) await connection.query(statement);
    // Execute Lucci's migration unchanged, using its existing delimiter wrapper.
    const migration = fs.readFileSync(path.join(backend,'../database/migrate-fer-17-price-lists.sql'),'utf8')
      .replace(/^SET NAMES\s+\S+;\s*$/gim,'').replace(/^DELIMITER\s+\S+\s*$/gim,'').replace(/END\s*\/\//g,'END;').trim();
    await connection.query(migration);
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
