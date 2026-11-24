// Read-only clock observations; only a fresh, owned tmpfs MariaDB is created.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const [backendArg, outArg] = process.argv.slice(2);
assert.ok(backendArg && outArg, 'Usage: node clock-stack.cjs PREPARED_BACKEND FRESH_OUTPUT_DIR');
const backend = path.resolve(backendArg), out = path.resolve(outArg);
assert.ok(!fs.existsSync(out), 'Never overwrite measurements.');
fs.mkdirSync(out, { recursive: true });
const { newProfile } = require(path.join(backend, 'test/helpers/cc260-disposable.cjs'));
const { openDatabase, removeDatabase } = require(path.join(backend, 'test/helpers/admin-account-db.cjs'));
const p = newProfile(258);
const report = { generatedUTC: new Date().toISOString(), observerPlatform: process.platform,
  observerNode: process.version, clocksChanged: false, measurements: [], commands: [] };
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function command(name, executable, args) {
  const before = Date.now();
  const result = cp.spawnSync(executable, args, { windowsHide: true, timeout: 30000 });
  const after = Date.now();
  const stdout = result.stdout || Buffer.alloc(0), stderr = result.stderr || Buffer.alloc(0);
  fs.writeFileSync(path.join(out, name + '-stdout.txt'), stdout);
  fs.writeFileSync(path.join(out, name + '-stderr.txt'), stderr);
  const entry = { name, executable, args, before, after, exitCode: result.status,
    error: result.error?.code, stdoutPath: name + '-stdout.txt', stdoutSha256: hash(stdout),
    stderrPath: name + '-stderr.txt', stderrSha256: hash(stderr) };
  report.commands.push(entry);
  return { ...entry, text: stdout.toString('utf8') };
}
function measurement(name, sample, epoch) {
  assert.ok(Number.isFinite(epoch));
  report.measurements.push({ name, epochMs: epoch, observerBefore: sample.before, observerAfter: sample.after,
    offsetMinMs: epoch - sample.after, offsetMaxMs: epoch - sample.before,
    offsetMidpointMs: epoch - (sample.before + sample.after) / 2 });
}
(async () => {
  let session;
  try {
    report.measurements.push({ name: 'observer-node', epochMs: Date.now(), utc: new Date().toISOString() });
    const windows = command('windows-date', 'powershell.exe', ['-NoProfile', '-Command', '[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()']);
    assert.equal(windows.exitCode, 0); measurement('windows', windows, Number(windows.text.trim()));
    command('windows-time-status', 'w32tm.exe', ['/query', '/status']);
    command('windows-ntp-reference', 'w32tm.exe', ['/stripchart', '/computer:time.windows.com', '/dataonly', '/samples:3']);
    const wsl = command('wsl-date', 'wsl.exe', ['-d', 'Ubuntu-24.04', '--', 'date', '-u', '+%s%3N']);
    assert.equal(wsl.exitCode, 0); measurement('wsl', wsl, Number(wsl.text.trim()));
    command('wsl-time-source', 'wsl.exe', ['-d', 'Ubuntu-24.04', '--', 'sh', '-lc',
      'timedatectl show -p NTPSynchronized -p NTP -p Timezone; cat /sys/devices/system/clocksource/clocksource0/current_clocksource']);
    const name = 'audit355-clock-' + crypto.randomUUID();
    const docker = command('docker-date', 'docker', ['run', '--rm', '--name', name,
      '--label', 'ferrepatagonia.audit355-clock=' + name, '--entrypoint', 'date', 'mariadb:11.4', '-u', '+%s%3N']);
    assert.equal(docker.exitCode, 0); measurement('docker', docker, Number(docker.text.trim()));
    session = await openDatabase(p, 258, () => {});
    report.mariadb = { container: p.container, containerId: p.id, database: p.database, storage: 'tmpfs', persistentDatabaseUsed: false };
    for (let i = 0; i < 3; i++) {
      const before = Date.now();
      const [row] = await session.connection.query("SELECT CAST(ROUND(UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000) AS SIGNED) epoch, DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') utc, VERSION() version, @@system_time_zone systemZone, @@session.time_zone sessionZone");
      const after = Date.now();
      measurement('mariadb-' + i, { before, after }, Number(row.epoch));
      report.mariadb.lastRow = { ...row, epoch: String(row.epoch) };
    }
  } finally {
    await session?.connection.end();
    await removeDatabase(p, 258);
    report.ownedMariaDBRemoved = true;
    report.finishedUTC = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report.measurements));
})().catch(e => { console.error(String(e.message).replaceAll(p.password, '[redacted]')); process.exitCode = 1; });
