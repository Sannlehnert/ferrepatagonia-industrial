// Capture every outcome, then return a failing status for failed/blocked work.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const EXPECTED = {
  initial: '2616f478fe648dfa0ee1ee96b012273173cc9dd5',
  post335: 'd0e18514a46083aa3921acdf70c79dfa35500229',
};
function standardBlocks(phase, npmCli, affectedOnly) {
  const blocks = [
    ['install-backend', [npmCli, 'ci', '--prefix', 'backend', '--no-fund', '--no-audit'], true],
    ['install-frontend', [npmCli, 'ci', '--prefix', 'frontend', '--no-fund', '--no-audit'], true],
    ['build-backend', [npmCli, 'run', 'build', '--prefix', 'backend'], true],
    ['build-frontend', [npmCli, 'run', 'build', '--prefix', 'frontend'], true],
    ['account-admin', ['backend/test/helpers/run-admin-account-mariadb.cjs']],
    ...(phase === 'initial' ? [['company-approval', ['backend/test/helpers/run-company-approval-audit.cjs']]] : []),
    ['payments', ['backend/test/helpers/run-cuenta-corriente-mariadb.cjs', 'payments']],
    ['state-consistency', ['backend/test/helpers/run-state-consistency-mariadb.cjs']],
    ...(phase === 'initial' ? [['local-bootstrap', ['backend/test/helpers/run-local-bootstrap-mariadb.cjs']]] : []),
    ['catalog-browser', ['backend/test/helpers/run-catalog-presentation-browser.cjs']],
    ...(phase === 'initial' ? [['admin-browser', ['backend/test/helpers/run-e2e.cjs',
      ...['product-import', 'product-images', 'categories', 'categories-deactivation', 'categories-context-form',
        'client-status', 'credit-controls', 'accounts', 'dashboard-orders', 'orders-reconciliation']
        .map(n => 'admin/' + n + '.real.spec.ts')]]]
      : [['payment-actions', ['backend/test/helpers/run-e2e.cjs', '--payment-actions']],
        ['payments-browser', ['backend/test/helpers/run-e2e.cjs', '--payments']]]),
    ['receipts-browser', ['backend/test/helpers/run-e2e.cjs', '--receipts']],
  ].map(([name, args, prerequisite = false]) => ({ name, args, prerequisite }));
  return affectedOnly ? blocks.filter(b => b.prerequisite || ['payments', 'catalog-browser'].includes(b.name)) : blocks;
}
async function capturePlan({ root, output, executionSha, blocks, env = process.env, metadata = {},
  startupError, afterBlock, afterRun }) {
  root = path.resolve(root); output = path.resolve(output);
  assert.ok(!fs.existsSync(output), 'Use a fresh output directory; evidence is append-only.');
  fs.mkdirSync(output, { recursive: true });
  const manifest = { schemaVersion: 2, kind: 'new-standard-execution', ...metadata, executionSha,
    node: process.version, platform: process.platform, startedUTC: new Date().toISOString(),
    logEncoding: 'Raw stdout/stderr buffers in arrival order; explicit collector notes only for blocked/spawn-error records.',
    results: [], collectorErrors: [] };
  const save = () => fs.writeFileSync(path.join(output, 'execution.json'), JSON.stringify(manifest, null, 2) + '\n');
  save();
  async function runBlock(block, blockedReason) {
    const file = block.name + '.txt', target = path.join(output, file);
    const fd = fs.openSync(target, 'wx'), startedUTC = new Date().toISOString();
    let exitCode = null, signal = null, spawnError = null;
    if (blockedReason) {
      fs.writeSync(fd, 'BLOCKED: ' + blockedReason + '\nCommand was not executed.\n');
    } else {
      await new Promise(resolve => {
        let child;
        try {
          child = cp.spawn(block.executable || process.execPath, block.args, {
            cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (error) {
          spawnError = error.code || error.message; resolve(); return;
        }
        for (const stream of [child.stdout, child.stderr]) stream?.on('data', b => fs.writeSync(fd, b));
        child.once('error', error => { spawnError = error.code || error.message; });
        child.once('close', (code, childSignal) => { exitCode = code; signal = childSignal; resolve(); });
      });
      if (spawnError) fs.writeSync(fd, '\nCOLLECTOR SPAWN ERROR: ' + spawnError + '\n');
    }
    fs.closeSync(fd);
    const bytes = fs.readFileSync(target), text = bytes.toString('utf8');
    const count = key => [...text.matchAll(new RegExp('^# ' + key + ' (\\d+)', 'gm'))].at(-1)?.[1];
    const passed = count('pass') ?? /(?:^|\n)\s*(\d+) passed(?:\s|$)/.exec(text)?.[1];
    const skipped = Number(count('skipped') ?? /(?:^|\n)\s*(\d+) skipped(?:\s|$)/.exec(text)?.[1] ?? 0);
    const failed = Number(count('fail') ?? /(?:^|\n)\s*(\d+) failed(?:\s|$)/.exec(text)?.[1] ?? 0);
    const result = { name: block.name, executionSha,
      command: [block.executable || process.execPath, ...block.args], cwd: root,
      startedUTC, finishedUTC: new Date().toISOString(), exitCode, signal,
      result: blockedReason ? 'BLOCKED' : spawnError || exitCode !== 0 || failed > 0 ? 'FAIL' : 'PASS',
      passed: passed === undefined ? null : Number(passed), skipped, failed,
      blockedReason: blockedReason || null, spawnError, logPath: file, logSha256: hash(bytes),
      bytes: bytes.length, authentication: blockedReason ? 'GENERATED_BLOCKED_RECORD' : 'CAPTURED_NEW_EXECUTION' };
    manifest.results.push(result); save();
    console.log(JSON.stringify({ name: result.name, result: result.result, exitCode, passed: result.passed, failed }));
    return result;
  }
  let blockedReason = startupError || null;
  try {
    for (const block of blocks) {
      const result = await runBlock(block, blockedReason);
      if (block.prerequisite && result.result !== 'PASS') blockedReason = 'Prerequisite failed: ' + block.name;
      await afterBlock?.(block, result, manifest);
    }
  } catch (error) {
    manifest.collectorErrors.push(error.message);
  } finally {
    try { await afterRun?.(manifest); } catch (error) { manifest.collectorErrors.push(error.message); }
    manifest.finishedUTC = new Date().toISOString();
    const incomplete = manifest.results.length !== blocks.length;
    manifest.exitCode = incomplete || manifest.collectorErrors.length || manifest.results.some(r => r.result !== 'PASS') ? 1 : 0;
    manifest.result = manifest.exitCode === 0 ? 'PASS'
      : manifest.collectorErrors.length || incomplete ? 'COLLECTOR_ERROR' : 'FAILURES_RETAINED';
    manifest.artifactSha256 = Object.fromEntries(fs.readdirSync(output).filter(f => f.startsWith('catalog-'))
      .map(f => [f, hash(fs.readFileSync(path.join(output, f)))]));
    save();
    fs.writeFileSync(path.join(output, 'checks.txt'), manifest.results.map(r =>
      r.name + ': ' + r.result + '; pass=' + r.passed + '; fail=' + r.failed + '; skip=' + r.skipped
      + '; exit=' + r.exitCode + '; log=' + r.logPath + '; sha256=' + r.logSha256).join('\n') + '\n');
  }
  return manifest;
}
async function cli() {
  const [rootArg, phase, outputArg, npmCli, selection] = process.argv.slice(2);
  assert.ok(rootArg && EXPECTED[phase] && outputArg && npmCli && (!selection || selection === '--affected'),
    'Usage: node rerun.cjs EXACT_SHA_WORKTREE initial|post335 NEW_OUTPUT_DIR NPM_CLI [--affected]');
  const root = path.resolve(rootArg), output = path.resolve(outputArg);
  const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  let startupError;
  try { assert.equal(git('rev-parse', 'HEAD'), EXPECTED[phase]); assert.equal(git('status', '--porcelain'), ''); }
  catch (error) { startupError = 'Worktree identity/cleanliness check failed: ' + error.message; }
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
    E2E_PRODUCTION_BUILD: '0', FORCE_COLOR: '0' };
  const manifest = await capturePlan({ root, output, executionSha: EXPECTED[phase],
    blocks: standardBlocks(phase, npmCli, selection === '--affected'), env, startupError,
    metadata: { phase, selection: selection || 'full', historicalEvidenceReplaced: false,
      collectorSha256: hash(fs.readFileSync(__filename)),
      npm: cp.execFileSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8' }).trim(),
      clockPolicy: 'Unmodified original suites; no clock, expectation, timeout or test-source changes.' },
    afterBlock(block, result) {
      if (block.name !== 'catalog-browser' || result.result === 'BLOCKED') return;
      const original = path.join(root, 'frontend/test-results/catalog-313');
      for (const file of ['summary.json', 'coverage.csv', 'cleanup.json']) if (fs.existsSync(path.join(original, file)))
        fs.copyFileSync(path.join(original, file), path.join(output, 'catalog-' + file));
    },
    afterRun(value) { value.sourceStatusAfter = git('status', '--porcelain'); assert.equal(value.sourceStatusAfter, ''); },
  });
  process.exitCode = manifest.exitCode;
}
module.exports = { capturePlan, standardBlocks };
if (require.main === module) cli().catch(error => { console.error(error); process.exitCode = 1; });
