const fs = require('node:fs');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const output = process.argv[2];
assert.ok(output && !fs.existsSync(output), 'Supply a new JSON path.');
const samples = [];
for (let i = 0; i < 3; i++) {
  const name = 'audit355-clock-' + randomUUID();
  const args = ['run', '--rm', '--name', name, '--label', 'ferrepatagonia.audit355-clock=' + name,
    '--entrypoint', 'date', 'mariadb:11.4', '-u', '+%s%3N'];
  const hostBefore = Date.now();
  const stdout = cp.execFileSync('docker', args, { encoding: 'utf8', windowsHide: true });
  const hostAfter = Date.now(), dockerEpoch = Number(stdout.trim());
  assert.ok(Number.isSafeInteger(dockerEpoch));
  samples.push({ command: ['docker', ...args], rawStdout: stdout, hostBefore, hostAfter, dockerEpoch,
    offsetMidpointMs: dockerEpoch - (hostBefore + hostAfter) / 2,
    offsetMinMs: dockerEpoch - hostAfter, offsetMaxMs: dockerEpoch - hostBefore,
    containerRemoved: cp.execFileSync('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$'], { encoding: 'utf8' }).trim() === '' });
}
assert.ok(samples.every(s => s.containerRemoved));
const report = { generatedUTC: new Date().toISOString(), node: process.version,
  measurement: 'Container date versus host Date.now bracketing the Docker CLI call; bounds include process overhead.',
  clocksChanged: false, samples };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
