const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '../../..'), evidence = path.join(repo, 'docs/355/evidence');
const sync = path.join(evidence, 'synchronized-20261123');
const preparedBackend = path.resolve(process.argv[2] || '');
const papa = createRequire(path.join(preparedBackend, 'package.json'))('papaparse');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const beforeCommit = 'a1dadcd90d7c0e97b747ca6aa39fe4b9310252b1';
let preserved = 0, logRecords = 0, artifactHashes = 0, commandStreams = 0, jsonFiles = 0;
for (const rel of cp.execFileSync('git', ['ls-tree', '-r', '--name-only', beforeCommit, 'docs/355/evidence'], { cwd: repo, encoding: 'utf8' }).trim().split('\n')) {
  if (['docs/355/evidence/execution.json', 'docs/355/evidence/baseline-2616f47/execution.json',
    'docs/355/evidence/correction/artifact-index.json'].includes(rel)) continue;
  assert.deepEqual(fs.readFileSync(path.join(repo, rel)), cp.execFileSync('git', ['show', beforeCommit + ':' + rel], { cwd: repo, maxBuffer: 4 * 1024 * 1024 }), rel);
  preserved++;
}
const originalIndex = cp.execFileSync('git', ['show', beforeCommit + ':docs/355/evidence/correction/artifact-index.json'], { cwd: repo });
assert.deepEqual(fs.readFileSync(path.join(evidence, 'correction/artifact-index-a1dadcd.txt')), originalIndex);
let unavailable = 0;
for (const rel of ['execution.json', 'baseline-2616f47/execution.json']) {
  const m = read(path.join(evidence, rel));
  for (const r of m.results) { assert.equal(r.logAuthentication, 'UNAVAILABLE_ORIGINAL'); assert.equal(r.logPath, null); unavailable++; }
}
assert.equal(unavailable, 19);
for (const file of walk(evidence).filter(f => f.endsWith('.json'))) {
  const m = read(file); jsonFiles++;
  for (const [relative, expected] of Object.entries(m.artifactSha256 || {})) {
    assert.equal(hash(fs.readFileSync(path.resolve(path.dirname(file), relative))), expected, file + ': ' + relative); artifactHashes++;
  }
  for (const r of [...(m.results || []), ...(m.logPath && m.logSha256 ? [m] : [])]) if (r.logPath && r.logSha256) {
    assert.equal(hash(fs.readFileSync(path.resolve(path.dirname(file), r.logPath))), r.logSha256, file); logRecords++;
  }
  for (const c of m.commands || []) for (const stream of ['stdout', 'stderr']) if (c[stream + 'Path']) {
    assert.equal(hash(fs.readFileSync(path.join(path.dirname(file), c[stream + 'Path']))), c[stream + 'Sha256']); commandStreams++;
  }
}
const master = papa.parse(fs.readFileSync(path.join(repo, 'docs/309/catalogo-maestro.csv'), 'utf8'), { header: true, skipEmptyLines: true }).data;
let csvFiles = 0;
for (const file of walk(evidence).filter(f => f.endsWith('.csv'))) {
  const csv = papa.parse(fs.readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true });
  assert.deepEqual(csv.errors, [], file); assert.equal(csv.data.length, 100); assert.equal(new Set(csv.data.map(r => r.sku)).size, 100);
  assert.deepEqual(new Set(csv.data.map(r => r.sku)), new Set(master.map(r => r.sku))); csvFiles++;
}
for (const [phase, sha, paymentCount] of [['initial', '2616f478fe648dfa0ee1ee96b012273173cc9dd5', 23],
  ['post335', 'd0e18514a46083aa3921acdf70c79dfa35500229', 25]]) {
  const dir = path.join(sync, phase + '-final'), m = read(path.join(dir, 'execution.json'));
  assert.equal(m.executionSha, sha); assert.equal(m.platform, 'linux'); assert.equal(m.exitCode, 0); assert.equal(m.result, 'PASS');
  assert.equal(m.sourceStatusAfter, ''); assert.equal(m.explicitProbeWaitMilliseconds, 0);
  assert.deepEqual(m.results.map(r => r.name), ['payments', 'catalog-browser', 'persistence-http-admin-zero']);
  assert.ok(m.results.every(r => r.result === 'PASS' && r.exitCode === 0));
  assert.equal(m.results[0].passed, paymentCount); assert.equal(m.results[0].failed, 0);
  assert.equal(m.results[1].passed, 1); assert.equal(m.results[1].failed, 0);
  const probe = read(path.join(dir, 'http-admin-probe/execution.json'));
  assert.equal(probe.kind, 'new-standard-probe'); assert.equal(probe.settleMilliseconds, 0); assert.equal(probe.exitCode, 0);
  assert.equal(probe.executionSha, sha);
  const p = read(path.join(dir, 'http-admin-probe/admin-persistence.json'));
  assert.match(p.result, /^PASS/); assert.equal(p.response.http, 200);
  const before = p.stages.find(s => s.phase === 'before-api-restart-with-carts');
  assert.equal(before.products.length, 100); assert.equal(before.images.length, 100); assert.equal(before.carts.length, 2); assert.equal(before.items.length, 4);
  for (const stage of p.stages.filter(s => ['after-api-restart', 'after-mariadb-restart'].includes(s.phase)))
    for (const key of ['containerId', 'volumeName', 'products', 'carts', 'items', 'images']) assert.deepEqual(stage[key], before[key]);
  const cleanup = read(path.join(dir, 'http-admin-probe/cleanup.json'));
  assert.ok(Object.values(cleanup).every(v => v === true));
  assert.ok(Object.values(read(path.join(dir, 'catalog-cleanup.json'))).every(v => v === true));
}
for (const name of ['common-clock-aligned-before', 'common-clock-aligned-after']) {
  const m = read(path.join(sync, name, 'measurements.json'));
  assert.equal(m.observerPlatform, 'linux'); assert.equal(m.clocksChanged, false); assert.equal(m.ownedMariaDBRemoved, true);
  const rows = m.measurements.filter(r => r.name.startsWith('mariadb-'));
  assert.equal(rows.length, 3); assert.ok(rows.every(r => r.offsetMinMs <= 0 && r.offsetMaxMs >= 0), 'SQL time must lie within the actual Node request interval, without added tolerance.');
}
const contracts = read(path.join(sync, 'collector-contracts-verified/execution.json'));
assert.equal(contracts.exitCode, 0); assert.equal(contracts.results[0].passed, 7); assert.equal(contracts.results[0].failed, 0);
assert.equal(contracts.collectorSha256, hash(fs.readFileSync(path.join(__dirname, 'rerun.cjs'))));
assert.equal(contracts.testSha256, hash(fs.readFileSync(path.join(__dirname, 'rerun.test.cjs'))));
assert.equal(cp.execFileSync('git', ['diff', '--name-only', beforeCommit, '--', '.', ':(exclude)docs/355'], { cwd: repo, encoding: 'utf8' }).trim(), '');
cp.execFileSync('git', ['diff', '--check'], { cwd: repo });
console.log(JSON.stringify({ result: 'PASS', jsonFiles, preservedPriorEvidenceFiles: preserved, previousIndexSnapshotPreserved: true,
  historicalUnauthenticatedRecords: unavailable, verifiedLogRecords: logRecords, artifactHashChecks: artifactHashes,
  verifiedClockCommandStreams: commandStreams, csvFiles, uniqueSkusPerCsv: 100,
  standardPayments: { initial: '23/23', post335: '25/25' }, standardCatalogBothPhases: 'PASS',
  standardHttpAdminZeroWaitBothPhases: 'PASS', clockSqlSamplesWithinNodeRequestIntervals: true,
  collectorContracts: '7/7', functionalDiffEmpty: true }, null, 2));
