const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
const database = `admin_products_test_${token}`;
const container = `admin-products-test-${token}`;
const password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim();

async function main() {
  let started = false;
  let connection;
  try {
    // Sin volúmenes, sin .env y sin puertos fijos. Solo loopback.
    docker('run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::3306',
      '-e', `MARIADB_ROOT_PASSWORD=${password}`, '-e', `MARIADB_DATABASE=${database}`,
      'mariadb:11.4');
    started = true;
    const info = JSON.parse(docker('inspect', container))[0];
    const port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);
    for (let i = 0; i < 60; i++) {
      try {
        connection = await mariadb.createConnection({ host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000 });
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (!connection) throw Error('MariaDB desechable no disponible');
    const schema = fs.readFileSync(path.join(backend, '../database/schema.sql'), 'utf8');
    for (const statement of schema.split(';').filter(s => s.trim())) await connection.query(statement);
    console.log(JSON.stringify({ database, port, version: await connection.query('SELECT VERSION() AS version'), image: info.Image }));
    const fingerprint = async () => {
      const tables = await connection.query('SHOW TABLES');
      const definitions = [];
      for (const row of tables) {
        const table = Object.values(row)[0];
        const [ddl] = await connection.query('SHOW CREATE TABLE ' + table);
        definitions.push(ddl['Create Table'].replace(/AUTO_INCREMENT=\d+ /g, ''));
      }
      return require('node:crypto').createHash('sha256').update(definitions.sort().join('\n')).digest('hex');
    };
    const schemaBefore = await fingerprint();
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/adminProduct.test.cjs', 'test/catalog.integration.test.cjs', 'test/register.integration.test.cjs', 'test/auth.me.integration.test.cjs', 'test/clientes.integration.test.cjs', 'test/orm.integration.test.cjs', 'test/database-policy.integration.test.cjs'], {
      cwd: backend, stdio: 'inherit', env: { ...process.env,
        DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
        JWT_SECRET: randomUUID(), DB_HOST: '127.0.0.1', DB_PORT: String(port),
        DB_NAME: database, DB_USER: 'root', DB_PASSWORD: password,
        ADMIN_PRODUCTS_TEST_DATABASE: database, CATALOG_TEST_DATABASE: database,
        REGISTER_TEST_DATABASE: database, AUTH_ME_TEST_DATABASE: database, CLIENTES_TEST_DATABASE: database,
      },
    });
    const schemaAfter = await fingerprint();
    console.log(JSON.stringify({ schemaBefore, schemaAfter, unchanged: schemaBefore === schemaAfter }));
    require('node:assert/strict').equal(schemaAfter, schemaBefore, 'DDL must remain unchanged');
    if (result.error) throw result.error;
    process.exitCode = result.status === 0 ? 0 : 1;
  } finally {
    if (connection) await connection.end();
    if (started) docker('rm', '-f', container);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
