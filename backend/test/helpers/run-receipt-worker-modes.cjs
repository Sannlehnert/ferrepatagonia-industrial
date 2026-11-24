const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const backend = join(__dirname, '..', '..');
const testFile = join(backend, 'test', 'receipt-worker.test.cjs');
const testEnv = join(backend, 'test', 'helpers', 'test-env.cjs');

function run(label, args) {
  console.log(`\n[receipt-worker] modo ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: backend,
    env: { ...process.env, RECEIPT_WORKER_MODE: label },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('development', ['--require', testEnv, '--import', 'tsx', '--test', testFile]);
run('production', ['--require', testEnv, '--test', testFile]);
