const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const repository = path.resolve(__dirname, '../../..');
const reference = path.resolve(process.argv[2] || '');
assert.ok(fs.existsSync(path.join(reference, 'backend/node_modules/papaparse')), 'Pass a prepared SHA worktree for CSV parser.');
const papa = createRequire(path.join(reference, 'backend/package.json'))('papaparse');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const evidence = path.join(repository, 'docs/355/evidence');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(evidence), authenticatedLogs = [], historical = [];
let artifacts = 0, jsonFiles = 0, csvFiles = 0;
const auditedHead = 'bd3aa81986fa9c83505f7a23f76107b4786756b9';
const paths = ['docs/355/evidence/execution.json', 'docs/355/evidence/baseline-2616f47/execution.json'];
for (const name of paths) {
  const current = read(path.join(repository, name));
  const originalBytes = cp.execFileSync('git', ['show', auditedHead + ':' + name], { cwd: repository });
  const original = JSON.parse(originalBytes);
  assert.equal(current.historicalManifestAtAuditedHead.sha256, hash(originalBytes));
  assert.equal(current.verifiedSha, original.verifiedSha);
  assert.equal(current.generatedUTC, original.generatedUTC);
  assert.equal(current.results.length, original.results.length);
  const checks = name.replace('execution.json', 'checks.txt');
  assert.deepEqual(fs.readFileSync(path.join(repository, checks)), cp.execFileSync('git', ['show', auditedHead + ':' + checks], { cwd: repository }));
  for (const previous of original.results) {
    const r = current.results.find(r => r.name === previous.name);
    for (const k of Object.keys(previous)) assert.deepEqual(r[k], previous[k], name + ' historical field ' + k);
    assert.equal(r.logAuthentication, 'UNAVAILABLE_ORIGINAL'); assert.equal(r.logPath, null);
    historical.push({ phase: current.verifiedSha, name: r.name, hash: r.logSha256, authenticated: false });
    const replay = read(path.resolve(path.dirname(path.join(repository, name)), r.reexecution.manifest));
    assert.equal(replay.executionSha, current.verifiedSha);
    assert.ok(replay.results.some(n => n.name === r.name));
  }
}
for (const file of files.filter(f => f.endsWith('.json'))) {
  const value = read(file); jsonFiles++;
  for (const [relative, expected] of Object.entries(value.artifactSha256 || {})) {
    const artifact = path.resolve(path.dirname(file), relative);
    assert.equal(hash(fs.readFileSync(artifact)), expected, artifact); artifacts++;
  }
  const results = value.kind === 'new-standard-execution' ? value.results : value.logPath && value.logSha256 ? [value] : [];
  for (const r of results) {
    const log = path.resolve(path.dirname(file), r.logPath), bytes = fs.readFileSync(log), text = bytes.toString('utf8');
    assert.ok(bytes.length > 0); assert.equal(hash(bytes), r.logSha256, log);
    if (value.kind === 'new-standard-execution') {
      const count = [...text.matchAll(/^# pass (\d+)/gm)].at(-1)?.[1] ?? /(?:^|\n)\s*(\d+) passed(?:\s|$)/.exec(text)?.[1];
      assert.equal(r.passed, count === undefined ? null : Number(count));
      assert.equal(r.result, r.exitCode === 0 ? 'PASS' : 'FAIL');
      const line = fs.readFileSync(path.join(path.dirname(file), 'checks.txt'), 'utf8').split('\n').find(s => s.startsWith(r.name + ':'));
      assert.ok(line?.includes('sha256=' + r.logSha256) && line.includes('pass=' + r.passed) && line.includes('exit=' + r.exitCode));
    }
    authenticatedLogs.push({ file: path.relative(evidence, log).replaceAll('\\', '/'), sha256: r.logSha256 });
  }
}
const master = papa.parse(fs.readFileSync(path.join(reference, 'docs/309/catalogo-maestro.csv'), 'utf8'), { header: true, skipEmptyLines: true }).data;
for (const file of files.filter(f => f.endsWith('.csv'))) {
  const parsed = papa.parse(fs.readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.errors, [], file); assert.equal(parsed.data.length, 100, file);
  assert.equal(new Set(parsed.data.map(r => r.sku)).size, 100, file);
  assert.deepEqual(new Set(parsed.data.map(r => r.sku)), new Set(master.map(r => r.sku)), file);
  csvFiles++;
}
const probe = read(path.join(evidence, 'correction/persistence-diagnostic/admin-persistence.json'));
assert.match(probe.result, /^PASS/);
const before = probe.stages.find(s => s.phase === 'before-api-restart-with-carts');
for (const stage of probe.stages.filter(s => ['after-api-restart', 'after-mariadb-restart'].includes(s.phase))) {
  for (const key of ['containerId', 'volumeName', 'products', 'carts', 'items', 'images']) assert.deepEqual(stage[key], before[key], key);
}
for (const which of ['persistence-standard', 'persistence-diagnostic']) {
  const cleanup = read(path.join(evidence, 'correction', which, 'cleanup.json'));
  assert.deepEqual(cleanup, { containerRemoved: true, volumeRemoved: true, ownedImagesRemoved: true, sourceFilesUntouchedByTest: true });
}
assert.equal(historical.length, 19);
const outside = cp.execFileSync('git', ['diff', '--name-only', auditedHead, '--', '.', ':(exclude)docs/355'], { cwd: repository, encoding: 'utf8' }).trim();
assert.equal(outside, '');
cp.execFileSync('git', ['diff', '--check'], { cwd: repository });
console.log(JSON.stringify({ result: 'PASS', jsonFiles, csvFiles, uniqueSkusPerCsv: 100, artifactHashChecks: artifacts,
  authenticatedNewLogs: authenticatedLogs.length, unauthenticatedHistoricalRecords: historical.length,
  historicalResultsAndChecksPreserved: true, persistenceSnapshotsEqual: true, applicationDiffEmpty: true }, null, 2));
