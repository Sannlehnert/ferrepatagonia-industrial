const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', 'test/catalog-presentation.mariadb.test.cjs'], {
  cwd: path.resolve(__dirname, '../..'),
  env: { ...process.env, CATALOG313_BROWSER: '1' },
  stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
