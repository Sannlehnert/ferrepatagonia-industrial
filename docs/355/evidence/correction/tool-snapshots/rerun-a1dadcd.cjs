// Captures new executions; never reconstructs or overwrites historical logs.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const [rootArg, phase, outputArg, npmCli] = process.argv.slice(2);
assert.ok(rootArg && ['initial', 'post335'].includes(phase) && outputArg && npmCli,
  'Usage: node rerun.cjs EXACT_SHA_WORKTREE initial|post335 NEW_OUTPUT_DIR NPM_CLI');
const root = path.resolve(rootArg), output = path.resolve(outputArg);
assert.ok(!fs.existsSync(output), 'Use a fresh output directory; evidence is append-only.');
const expected = phase === 'initial' ? '2616f478fe648dfa0ee1ee96b012273173cc9dd5' : 'd0e18514a46083aa3921acdf70c79dfa35500229';
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), expected);
assert.equal(git('status', '--porcelain'), '');
fs.mkdirSync(output, { recursive: true });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
  E2E_PRODUCTION_BUILD: '0', FORCE_COLOR: '0' };
const blocks = [
  ['install-backend', [npmCli, 'ci', '--prefix', 'backend', '--no-fund', '--no-audit']],
  ['install-frontend', [npmCli, 'ci', '--prefix', 'frontend', '--no-fund', '--no-audit']],
  ['build-backend', [npmCli, 'run', 'build', '--prefix', 'backend']],
  ['build-frontend', [npmCli, 'run', 'build', '--prefix', 'frontend']],
  ['account-admin', ['backend/test/helpers/run-admin-account-mariadb.cjs']],
  ...(phase === 'initial' ? [['company-approval', ['backend/test/helpers/run-company-approval-audit.cjs']]] : []),
  ['payments', ['backend/test/helpers/run-cuenta-corriente-mariadb.cjs', 'payments']],
  ['state-consistency', ['backend/test/helpers/run-state-consistency-mariadb.cjs']],
  ...(phase === 'initial' ? [['local-bootstrap', ['backend/test/helpers/run-local-bootstrap-mariadb.cjs']]] : []),
  ['catalog-browser', ['backend/test/helpers/run-catalog-presentation-browser.cjs']],
  ...(phase === 'initial' ? [['admin-browser', ['backend/test/helpers/run-e2e.cjs',
    ...['product-import', 'product-images', 'categories', 'categories-deactivation', 'categories-context-form',
      'client-status', 'credit-controls', 'accounts', 'dashboard-orders', 'orders-reconciliation'].map(n => 'admin/' + n + '.real.spec.ts')]]]
    : [['payment-actions', ['backend/test/helpers/run-e2e.cjs', '--payment-actions']],
      ['payments-browser', ['backend/test/helpers/run-e2e.cjs', '--payments']]]),
  ['receipts-browser', ['backend/test/helpers/run-e2e.cjs', '--receipts']],
];
const manifest = { schemaVersion: 1, kind: 'new-standard-execution', phase, executionSha: expected,
  historicalEvidenceReplaced: false, node: process.version,
  npm: cp.execFileSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8' }).trim(),
  startedUTC: new Date().toISOString(), sourceStatusBefore: git('status', '--porcelain'),
  logEncoding: 'Raw stdout and stderr buffers, merged in observed arrival order; no postprocessing.',
  clockPolicy: 'No clock, expectation, timeout or test-source changes. Failures are retained.', results: [] };
function runBlock(name, args) {
  return new Promise((resolve, reject) => {
    const file = name + '.txt', target = path.join(output, file), fd = fs.openSync(target, 'wx');
    const start = new Date().toISOString();
    const child = cp.spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const write = chunk => fs.writeSync(fd, chunk);
    child.stdout.on('data', write); child.stderr.on('data', write);
    child.on('error', e => { fs.closeSync(fd); reject(e); });
    child.on('close', code => {
      fs.closeSync(fd);
      const bytes = fs.readFileSync(target), text = bytes.toString('utf8');
      const pass = [...text.matchAll(/^# pass (\d+)/gm)].at(-1)?.[1] ?? /(?:^|\n)\s*(\d+) passed(?:\s|$)/.exec(text)?.[1];
      const skipped = [...text.matchAll(/^# skipped (\d+)/gm)].at(-1)?.[1] ?? /(?:^|\n)\s*(\d+) skipped(?:\s|$)/.exec(text)?.[1] ?? '0';
      const failed = [...text.matchAll(/^# fail (\d+)/gm)].at(-1)?.[1] ?? /(?:^|\n)\s*(\d+) failed(?:\s|$)/.exec(text)?.[1] ?? '0';
      const result = { name, executionSha: expected, command: [process.execPath, ...args], cwd: root,
        environment: { E2E_PRODUCTION_BUILD: '0' }, startedUTC: start, finishedUTC: new Date().toISOString(),
        exitCode: code, result: code === 0 ? 'PASS' : 'FAIL', passed: pass === undefined ? null : Number(pass),
        skipped: Number(skipped), failed: Number(failed), logPath: file, logSha256: hash(bytes), bytes: bytes.length,
        authentication: 'CAPTURED_NEW_EXECUTION' };
      manifest.results.push(result); save('execution.json', manifest);
      console.log(JSON.stringify({ phase, name, exitCode: code, passed: result.passed, failed: result.failed, skipped: result.skipped }));
      resolve(code);
    });
  });
}
(async () => {
  for (const [name, args] of blocks) {
    const code = await runBlock(name, args);
    if (name.startsWith('install-') || name.startsWith('build-')) assert.equal(code, 0, name + ' is a prerequisite');
    if (name === 'catalog-browser') {
      const original = path.join(root, 'frontend/test-results/catalog-313');
      for (const file of ['summary.json', 'coverage.csv', 'cleanup.json']) {
        if (fs.existsSync(path.join(original, file))) {
          const bytes = fs.readFileSync(path.join(original, file));
          fs.writeFileSync(path.join(output, 'catalog-' + file), bytes);
        }
      }
    }
  }
  manifest.finishedUTC = new Date().toISOString();
  manifest.sourceStatusAfter = git('status', '--porcelain');
  assert.equal(manifest.sourceStatusAfter, '');
  manifest.result = manifest.results.every(r => r.exitCode === 0) ? 'PASS' : 'FAILURES_RETAINED';
  manifest.artifactSha256 = Object.fromEntries(fs.readdirSync(output).filter(f => f.startsWith('catalog-'))
    .map(f => [f, hash(fs.readFileSync(path.join(output, f)))]));
  save('execution.json', manifest);
  fs.writeFileSync(path.join(output, 'checks.txt'), manifest.results.map(r => `${r.name}: ${r.result}; pass=${r.passed}; fail=${r.failed}; skip=${r.skipped}; exit=${r.exitCode}; log=${r.logPath}; sha256=${r.logSha256}`).join('\n') + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; });
