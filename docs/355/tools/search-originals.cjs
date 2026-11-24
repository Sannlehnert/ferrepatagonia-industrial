const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const [workspace, repository, output] = process.argv.slice(2);
assert.ok(workspace && repository && output && !fs.existsSync(output));
const targets = new Set(['execution.json', 'baseline-2616f47/execution.json'].flatMap(p =>
  JSON.parse(fs.readFileSync(path.join(repository, 'docs/355/evidence', p))).results.map(r => r.logSha256)));
const roots = [
  ['project-workspace', workspace],
  ['original-checkout', 'C:/Users/santi/OneDrive/Escritorio/ferrepatagonia-industrial'],
  ['codex-dot-tmp', 'C:/Users/santi/.codex/.tmp'], ['codex-tmp', 'C:/Users/santi/.codex/tmp'],
  ['codex-attachments', 'C:/Users/santi/.codex/attachments'], ['current-process-temp', process.env.TEMP],
].filter(([, p]) => p && fs.existsSync(p));
let scanned = 0; const errors = [], matches = [], visited = new Set();
for (const [label, root] of roots) {
  const r = cp.spawnSync('rg', ['--files', '--hidden', '-g', '!**/node_modules/**', '-g', '!**/.git/**',
    '-g', '!**/correction-355*/**', '-g', '*.log', '-g', '*.txt', '-g', '*.out', '-g', '*355*', root],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status > 1) errors.push({ root: label, error: r.stderr });
  for (const file of r.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    if (visited.has(file)) continue; visited.add(file);
    try {
      if (fs.statSync(file).size > 100000000) { errors.push({ root: label, file: path.relative(root, file), error: 'size-limit' }); continue; }
      const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); scanned++;
      if (targets.has(hash)) matches.push({ root: label, file: path.relative(root, file).replaceAll('\\', '/'), sha256: hash });
    } catch (error) { errors.push({ root: label, file: path.relative(root, file), error: error.code }); }
  }
}
const report = { searchedUTC: new Date().toISOString(), roots: roots.map(([label]) => label), scanned, errors,
  matchedUniqueHashes: [...new Set(matches.map(m => m.sha256))], matches,
  recoveredOriginalExecutionLogs: 0, unauthenticatedHistoricalRecords: 19,
  interpretation: 'Only generic backend-build output matches. Its copies belong to other tasks, so neither #355 execution can be authenticated from them. They were not relabeled as recovered originals. No claim about inaccessible hosts or deleted files.',
  remoteInventory: 'artifact-inventory.json' };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ scanned, matchingFiles: matches.length, matchedUniqueHashes: report.matchedUniqueHashes, errors: errors.length }));
