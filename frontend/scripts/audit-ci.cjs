'use strict';

const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const severity = ['info', 'low', 'moderate', 'high', 'critical'];
const requiresBlock = level => level === 'high' || level === 'critical';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

const same = (left, right) =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

function auditInventory(lock) {
  const packages = lock?.packages;
  requireValid(lock?.lockfileVersion === 3 && object(packages) && object(packages['']),
    'Lockfile del frontend inválido.');
  const flags = ['dev', 'optional', 'peer', 'peerOptional'];
  // npm 10 reports the entire virtual inventory in both reports. Flags can overlap;
  // the root contributes to prod, but does not contribute to total.
  const counts = { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: Object.keys(packages).length - 1 };
  for (const [node, entry] of Object.entries(packages)) {
    requireValid(object(entry) && (!node ||
      (/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(node) &&
        !node.split('/').some(part => part === '.' || part === '..' || part.includes('\\')) &&
        typeof entry.version === 'string' && entry.version.length > 0 && !entry.link)),
    'Paquete del lockfile fuera del inventario compatible.');
    const marked = flags.filter(flag => entry[flag] === true);
    if (!marked.length) counts.prod++;
    else for (const flag of marked) counts[flag]++;
  }
  return counts;
}

function parseAudit(result, label, lock, inventory, omitDev = false) {
  requireValid(!result.error && !result.signal && [0, 1].includes(result.status),
    `Auditoría ${label}: npm no terminó correctamente.`);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Auditoría ${label}: JSON inválido.`);
  }
  const records = report?.vulnerabilities;
  const counts = report?.metadata?.vulnerabilities;
  const dependencies = report?.metadata?.dependencies;
  requireValid(report?.auditReportVersion === 2 && !Object.hasOwn(report, 'error') &&
    object(records) && object(counts) && object(dependencies) &&
    Object.keys(inventory).every(key => dependencies[key] === inventory[key]),
    `Auditoría ${label}: informe incompleto o inventario de dependencias incompatible con el lockfile.`);

  for (const [name, row] of Object.entries(records)) {
    requireValid(object(row) && row.name === name && severity.includes(row.severity) &&
      typeof row.isDirect === 'boolean' && typeof row.range === 'string' && row.range.length > 0 &&
      Array.isArray(row.nodes) && row.nodes.length > 0 &&
      row.nodes.every(node => typeof node === 'string' && node.startsWith('node_modules/') &&
        Object.hasOwn(lock.packages, node) && (!omitDev || lock.packages[node].dev !== true)) &&
      Array.isArray(row.effects) && row.effects.every(effect => typeof effect === 'string' &&
        Object.hasOwn(records, effect) && records[effect]?.via?.includes?.(name)) &&
      Array.isArray(row.via) && row.via.length > 0 && row.via.every(cause =>
        typeof cause === 'string'
          ? Object.hasOwn(records, cause)
          : object(cause) && typeof cause.url === 'string' && cause.url.length > 0 &&
            cause.name === name && cause.dependency === name && typeof cause.range === 'string' &&
            severity.includes(cause.severity) && severity.indexOf(cause.severity) <= severity.indexOf(row.severity)),
    `Auditoría ${label}: hallazgo inválido o incompleto (${name}).`);
  }
  const rows = Object.values(records);
  const grounded = new Set(rows.filter(row => row.via.some(object)).map(row => row.name));
  for (let previous = -1; previous !== grounded.size;) {
    previous = grounded.size;
    for (const row of rows) if (row.via.some(cause => grounded.has(cause))) grounded.add(row.name);
  }
  requireValid(grounded.size === rows.length, `Auditoría ${label}: hallazgo sin advisory de origen.`);
  requireValid(counts.total === rows.length &&
    severity.every(level => counts[level] === rows.filter(row => row.severity === level).length) &&
    result.status === Number(rows.some(row => requiresBlock(row.severity))),
  `Auditoría ${label}: totales o código de salida inconsistentes.`);
  return records;
}

function evaluate({ production, full, lock }) {
  const inventory = auditInventory(lock);
  const prodRecords = parseAudit(production, 'producción', lock, inventory, true);
  const fullRecords = parseAudit(full, 'completa', lock, inventory);
  requireValid(!Object.values(prodRecords).some(row => requiresBlock(row.severity)),
    'Producción tiene vulnerabilidades altas o críticas.');
  requireValid(Object.keys(prodRecords).every(name => Object.hasOwn(fullRecords, name)),
    'La auditoría completa omite hallazgos de producción.');
  requireValid(!Object.values(fullRecords).some(row => requiresBlock(row.severity)),
    'La auditoría completa tiene vulnerabilidades altas o críticas.');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function verifyInstallation(frontend, lock) {
  auditInventory(lock);
  const actual = readJson(path.join(frontend, 'node_modules/.package-lock.json')).packages;
  requireValid(object(actual) && Object.keys(actual).every(node => node && Object.hasOwn(lock.packages, node)),
    'El inventario instalado difiere del lockfile. Ejecutá npm ci.');
  for (const [node, entry] of Object.entries(lock.packages)) {
    if (!node || (entry.optional === true && !Object.hasOwn(actual, node))) continue;
    requireValid(actual[node]?.version === entry.version &&
      readJson(path.join(frontend, node, 'package.json')).version === entry.version,
    `La instalación no coincide con el lockfile en ${node}. Ejecutá npm ci.`);
  }
}

function runAudits(frontend, npm) {
  const manifestText = readFileSync(path.join(frontend, 'package.json'), 'utf8');
  const lockText = readFileSync(path.join(frontend, 'package-lock.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  const lock = JSON.parse(lockText);
  verifyInstallation(frontend, lock);
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const entries = value => Object.entries(value[field] ?? {}).map(entry => JSON.stringify(entry));
    requireValid(same(entries(manifest), entries(lock.packages[''])),
      'El manifiesto del frontend no coincide con el lockfile.');
  }

  const cwd = mkdtempSync(path.join(tmpdir(), 'ferre-frontend-audit-'));
  try {
    writeFileSync(path.join(cwd, 'package.json'), manifestText);
    writeFileSync(path.join(cwd, 'package-lock.json'), lockText);
    const userconfig = path.join(cwd, 'user.npmrc');
    const globalconfig = path.join(cwd, 'global.npmrc');
    writeFileSync(userconfig, '');
    writeFileSync(globalconfig, '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(npm_config_|node_env$|node_options$|node_path$)/i.test(key)));
    const audit = extra => spawnSync(process.execPath, [
      npm, 'audit', '--audit-level=high', '--json', '--package-lock-only',
      '--workspaces=false', '--audit=true', '--offline=false', '--registry=https://registry.npmjs.org/',
      `--userconfig=${userconfig}`, `--globalconfig=${globalconfig}`,
      '--include=prod', '--include=optional', '--include=peer', ...extra,
    ], { cwd, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return { lock, production: audit(['--omit=dev']), full: audit(['--include=dev']) };
  } finally {
    // This path was created exclusively for the two audit snapshots.
    rmSync(cwd, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    requireValid(process.env.npm_execpath, 'Ejecutá la auditoría mediante npm run audit:ci.');
    const { lock, production, full } = runAudits(path.resolve(__dirname, '..'), process.env.npm_execpath);
    for (const [label, result] of [['producción', production], ['completa', full]]) {
      console.log(`Informe de auditoría ${label} (npm exit ${result.status}):\n${result.stdout ?? ''}`);
    }
    evaluate({ production, full, lock });
    console.log('Auditoría aprobada sin excepciones.');
  } catch (error) {
    console.error(`Auditoría bloqueada: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { evaluate, runAudits };
