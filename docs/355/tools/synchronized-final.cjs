// Final coherent acceptance plan, using unmodified suites and probe wait=0.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { capturePlan } = require('./rerun.cjs');
const [rootArg, phase, outArg] = process.argv.slice(2);
const shas = { initial: '2616f478fe648dfa0ee1ee96b012273173cc9dd5', post335: 'd0e18514a46083aa3921acdf70c79dfa35500229' };
assert.ok(rootArg && outArg && shas[phase]);
const root = path.resolve(rootArg), output = path.resolve(outArg);
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), shas[phase]); assert.equal(git('status', '--porcelain'), '');
assert.equal(process.platform, 'linux');
const checksum = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const env = { ...process.env, E2E_PRODUCTION_BUILD: '0', FORCE_COLOR: '0' };
capturePlan({ root, output, executionSha: shas[phase], env,
  metadata: { phase, selection: 'standard-synchronized-final',
    wrapperSha256: checksum(__filename), collectorSha256: checksum(path.join(__dirname, 'rerun.cjs')),
    npm: cp.execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    clockStrategy: 'Node Linux in the already NTP-synchronized WSL kernel shared by Docker/MariaDB; no clock overrides.',
    environment: { DOCKER_HOST: env.DOCKER_HOST, PLAYWRIGHT_BROWSERS_PATH: env.PLAYWRIGHT_BROWSERS_PATH,
      LD_LIBRARY_PATH: env.LD_LIBRARY_PATH }, explicitProbeWaitMilliseconds: 0,
    productionCodeChanged: false, originalTestsChanged: false, assertionsChanged: false, timeoutsChanged: false },
  blocks: [
    { name: 'payments', args: ['backend/test/helpers/run-cuenta-corriente-mariadb.cjs', 'payments'] },
    { name: 'catalog-browser', args: ['backend/test/helpers/run-catalog-presentation-browser.cjs'] },
    { name: 'persistence-http-admin-zero', args: [path.join(__dirname, 'persist-admin.cjs'), root,
      path.join(output, 'http-admin-probe'), '0'] },
  ],
  afterBlock(block, result) {
    if (block.name !== 'catalog-browser' || result.result === 'BLOCKED') return;
    for (const file of ['summary.json', 'coverage.csv', 'cleanup.json']) {
      const source = path.join(root, 'frontend/test-results/catalog-313', file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(output, 'catalog-' + file));
    }
  },
  afterRun(m) { m.sourceStatusAfter = git('status', '--porcelain'); assert.equal(m.sourceStatusAfter, ''); },
}).then(m => { console.log(JSON.stringify({ phase, result: m.result, exitCode: m.exitCode })); process.exitCode = m.exitCode; })
  .catch(error => { console.error(error); process.exitCode = 1; });
