// Contract fixtures only: these child processes never execute product suites.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { capturePlan } = require('./rerun.cjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audit355-collector-contract-'));
const block = (name, code, prerequisite = false) => ({ name, args: ['-e', code], prerequisite });
const checksum = b => crypto.createHash('sha256').update(b).digest('hex');
async function fixture(blocks, check, extra = {}) {
  const root = temp(), output = path.join(root, 'capture');
  try {
    const m = await capturePlan({ root, output, executionSha: 'COLLECTOR_CONTRACT_FIXTURE_NOT_PRODUCT',
      metadata: { kind: 'collector-contract-fixture' }, blocks, ...extra });
    const saved = JSON.parse(fs.readFileSync(path.join(output, 'execution.json')));
    assert.deepEqual(saved, m);
    assert.ok(fs.existsSync(path.join(output, 'checks.txt')));
    for (const r of m.results) assert.equal(checksum(fs.readFileSync(path.join(output, r.logPath))), r.logSha256);
    await check(m, root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('all successful child processes produce PASS and aggregate exit 0', async () => {
  await fixture([block('ok', "console.log('fixture success')")], m => {
    assert.equal(m.result, 'PASS'); assert.equal(m.exitCode, 0); assert.equal(m.results[0].result, 'PASS');
  });
});
test('a failing suite preserves its complete log and subsequent results, aggregate exit 1', async () => {
  await fixture([block('fail', "console.log('before failure');console.error('expected fixture failure');process.exit(17)"),
    block('later', "console.log('later fixture executed')")], m => {
    assert.equal(m.exitCode, 1); assert.equal(m.result, 'FAILURES_RETAINED');
    assert.equal(m.results[0].exitCode, 17); assert.equal(m.results[0].result, 'FAIL');
    assert.equal(m.results[1].result, 'PASS');
  });
});
test('failed prerequisite records dependent work as BLOCKED without executing it', async () => {
  await fixture([block('prerequisite', 'process.exit(23)', true),
    block('dependent', "require('fs').writeFileSync('should-not-exist','bad')")], (m, root) => {
    assert.equal(m.exitCode, 1); assert.equal(m.results[1].result, 'BLOCKED');
    assert.equal(m.results[1].exitCode, null); assert.match(m.results[1].blockedReason, /prerequisite/);
    assert.equal(fs.existsSync(path.join(root, 'should-not-exist')), false);
  });
});
test('spawn errors preserve a FAIL record and cannot produce aggregate success', async () => {
  await fixture([{ name: 'missing-executable', executable: path.join(os.tmpdir(), 'missing-audit355-executable'), args: [] }], m => {
    assert.equal(m.exitCode, 1); assert.equal(m.results[0].result, 'FAIL'); assert.equal(m.results[0].spawnError, 'ENOENT');
  });
});
test('final verification errors preserve logs and force COLLECTOR_ERROR/exit 1', async () => {
  await fixture([block('ok', "console.log('fixture success')")], m => {
    assert.equal(m.exitCode, 1); assert.equal(m.result, 'COLLECTOR_ERROR');
    assert.deepEqual(m.collectorErrors, ['expected final verification fixture']);
  }, { afterRun() { throw Error('expected final verification fixture'); } });
});
test('real CLI propagates prerequisite failure to its process exit status', () => {
  const sourceRoot = process.env.AUDIT355_CLI_FIXTURE_ROOT;
  assert.ok(sourceRoot, 'Set AUDIT355_CLI_FIXTURE_ROOT to a clean d0e1851 worktree.');
  const root = temp(), fakeNpm = path.join(root, 'fake-npm.cjs'), output = path.join(root, 'capture');
  try {
    fs.writeFileSync(fakeNpm, "if(process.argv.includes('--version'))console.log('CONTRACT-FIXTURE');else{console.log('simulated installation failure; no package action performed');process.exit(42)}");
    const child = cp.spawnSync(process.execPath, [path.join(__dirname, 'rerun.cjs'), sourceRoot, 'post335', output, fakeNpm, '--affected'],
      { encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 1);
    const m = JSON.parse(fs.readFileSync(path.join(output, 'execution.json')));
    assert.equal(m.results[0].exitCode, 42); assert.equal(m.exitCode, 1);
    assert.ok(m.results.slice(1).every(r => r.result === 'BLOCKED'));
    assert.ok(fs.existsSync(path.join(output, 'install-backend.txt')));
    assert.ok(fs.existsSync(path.join(output, 'checks.txt')));
    console.log('CLI fixture: exit=1, installation exit=42, 5 dependent records BLOCKED, evidence preserved.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('real CLI preserves a blocked manifest when its npm version probe fails', () => {
  const sourceRoot = process.env.AUDIT355_CLI_FIXTURE_ROOT;
  assert.ok(sourceRoot);
  const root = temp(), output = path.join(root, 'capture');
  try {
    const child = cp.spawnSync(process.execPath, [path.join(__dirname, 'rerun.cjs'), sourceRoot,
      'post335', output, path.join(root, 'missing-npm.cjs'), '--affected'], { encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 1);
    const m = JSON.parse(fs.readFileSync(path.join(output, 'execution.json')));
    assert.equal(m.exitCode, 1); assert.equal(m.npm, null); assert.ok(m.npmVersionError);
    assert.ok(m.results.every(r => r.result === 'BLOCKED'));
    assert.ok(fs.existsSync(path.join(output, 'checks.txt')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
