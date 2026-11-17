'use strict';

const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const expires = '2026-11-24T00:00:00.000Z';
const severity = ['info', 'low', 'moderate', 'high', 'critical'];
const requiresBlock = level => level === 'high' || level === 'critical';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

// npm audit's reviewed via graph. An empty list denotes the single direct advisory.
const via = {
  '@vue/language-core': ['picomatch'],
  fdir: ['picomatch'],
  'npm-run-all2': ['picomatch'],
  picomatch: [],
  tinyglobby: ['fdir', 'picomatch'],
  'unplugin-utils': ['picomatch'],
  vite: ['picomatch', 'tinyglobby'],
  'vite-plugin-inspect': ['unplugin-utils'],
  'vite-plugin-vue-devtools': ['vite-plugin-inspect'],
  'vue-tsc': ['@vue/language-core'],
};

// Reviewed incoming lockfile edges into the graph, including optional peers and root declarations.
const edges = [
  '|devDependencies|npm-run-all2|^9.0.3',
  '|devDependencies|vite|^8.2.2',
  '|devDependencies|vite-plugin-vue-devtools|^8.2.1',
  '|devDependencies|vue-tsc|^3.3.11',
  'node_modules/@tailwindcss/vite|peerDependencies|vite|^5.2.0 || ^6 || ^7 || ^8',
  'node_modules/@vitejs/plugin-vue|peerDependencies|vite|^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0',
  'node_modules/@vue/language-core|dependencies|picomatch|^4.0.4',
  'node_modules/fdir|peerDependencies|picomatch|^3 || ^4',
  'node_modules/npm-run-all2|dependencies|picomatch|^4.0.2',
  'node_modules/tinyglobby|dependencies|fdir|^6.5.0',
  'node_modules/tinyglobby|dependencies|picomatch|^4.0.4',
  'node_modules/unplugin-utils|dependencies|picomatch|^4.0.4',
  'node_modules/vite|dependencies|picomatch|^4.0.7',
  'node_modules/vite|dependencies|tinyglobby|^0.2.17',
  'node_modules/vite-dev-rpc|peerDependencies|vite|^2.9.0 || ^3.0.0-0 || ^4.0.0-0 || ^5.0.0-0 || ^6.0.1 || ^7.0.0-0 || ^8.0.0',
  'node_modules/vite-hot-client|peerDependencies|vite|^2.6.0 || ^3.0.0 || ^4.0.0 || ^5.0.0-0 || ^6.0.0-0 || ^7.0.0-0 || ^8.0.0',
  'node_modules/vite-plugin-inspect|dependencies|unplugin-utils|^0.3.1',
  'node_modules/vite-plugin-inspect|peerDependencies|vite|^6.0.0 || ^7.0.0-0 || ^8.0.0-0',
  'node_modules/vite-plugin-vue-devtools|dependencies|vite-plugin-inspect|^11.3.3',
  'node_modules/vite-plugin-vue-devtools|peerDependencies|vite|^6.0.0 || ^7.0.0 || ^8.0.0',
  'node_modules/vite-plugin-vue-inspector|peerDependencies|vite|^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0',
  'node_modules/vue-tsc|dependencies|@vue/language-core|3.3.14',
];
const same = (left, right) =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

function parseAudit(result, label) {
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
    ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total'].every(key =>
      Number.isSafeInteger(dependencies[key]) && dependencies[key] >= 0),
  `Auditoría ${label}: informe inválido o incompleto.`);

  for (const [name, row] of Object.entries(records)) {
    requireValid(object(row) && row.name === name && severity.includes(row.severity) &&
      typeof row.isDirect === 'boolean' && typeof row.range === 'string' && row.range.length > 0 &&
      Array.isArray(row.nodes) && row.nodes.length > 0 &&
      row.nodes.every(node => typeof node === 'string' && node.startsWith('node_modules/')) &&
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

function verifyLockfile(lock) {
  const packages = lock?.packages;
  requireValid(lock?.lockfileVersion === 3 && object(packages) && object(packages['']),
    'Lockfile del frontend inválido.');
  const locked = Object.entries(packages).filter(([node, entry]) =>
    /(^|\/)node_modules\/picomatch$/.test(node) || entry?.name === 'picomatch');
  requireValid(locked.length === 1 && locked[0][0] === 'node_modules/picomatch' &&
    locked[0][1].version === '4.0.7' && locked[0][1].dev === true,
  'La excepción exige una sola instalación de picomatch@4.0.7, de desarrollo.');

  const actualEdges = [];
  for (const [node, entry] of Object.entries(packages)) {
    requireValid(object(entry), 'Entrada inválida en el lockfile.');
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(entry[kind] ?? {})) {
        if (!Object.hasOwn(via, name) && !String(range).startsWith('npm:picomatch@')) continue;
        requireValid(node ? entry.dev === true : kind === 'devDependencies',
          'La ruta revisada de picomatch alcanza dependencias de producción.');
        actualEdges.push(`${node}|${kind}|${name}|${range}`);
      }
    }
  }
  requireValid(same(actualEdges, edges) &&
    Object.keys(via).every(name => packages[`node_modules/${name}`]?.dev === true),
  'Cambió el árbol de desarrollo autorizado para picomatch.');
}

function evaluate({ production, full, lock, now }) {
  const prodRecords = parseAudit(production, 'producción');
  const fullRecords = parseAudit(full, 'completa');
  requireValid(!Object.values(prodRecords).some(row => requiresBlock(row.severity)),
    'Producción tiene vulnerabilidades altas o críticas.');
  requireValid(Object.keys(prodRecords).every(name => Object.hasOwn(fullRecords, name)),
    'La auditoría completa omite hallazgos de producción.');
  const severe = Object.keys(fullRecords).filter(name => requiresBlock(fullRecords[name].severity));
  if (!severe.length) return [];

  requireValid(Number.isFinite(now) && now < Date.parse(expires),
    `La excepción GHSA-fc5q-39xc-vjpf venció (${expires}).`);
  requireValid(!Object.hasOwn(prodRecords, 'picomatch'),
    'La auditoría de producción detectó picomatch.');
  verifyLockfile(lock);
  requireValid(same(severe, Object.keys(via)), 'Hay hallazgos altos o críticos fuera del conjunto autorizado.');
  requireValid(same(Object.keys(fullRecords), severe), 'Hay hallazgos nuevos que invalidan la excepción.');
  for (const [name, expected] of Object.entries(via)) {
    const row = fullRecords[name];
    // npm 10 omits some reverse edges in effects. The full via graph and lockfile are authoritative.
    requireValid(row.severity === 'high' && same(row.nodes, [`node_modules/${name}`]),
      `Cambió el alcance autorizado de ${name}.`);
    requireValid(name === 'picomatch'
      ? row.via.length === 1 && row.via[0]?.url === advisory && row.via[0].severity === 'high'
      : same(row.via, expected),
    `Advisory o cadena transitiva no autorizada en ${name}.`);
  }
  return severe.sort();
}

function runAudit(extra) {
  return spawnSync(process.execPath, [
    process.env.npm_execpath, 'audit', ...extra, '--audit-level=high', '--json',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
}

if (require.main === module) {
  try {
    requireValid(process.env.npm_execpath, 'Ejecutá la auditoría mediante npm run audit:ci.');
    const production = runAudit(['--omit=dev']);
    const full = runAudit([]);
    for (const [label, result] of [['producción', production], ['completa', full]]) {
      console.log(`Informe de auditoría ${label} (npm exit ${result.status}):\n${result.stdout ?? ''}`);
    }
    const lock = JSON.parse(readFileSync(path.resolve(__dirname, '../package-lock.json'), 'utf8'));
    const excepted = evaluate({ production, full, lock, now: Date.now() });
    console.log(excepted.length
      ? `Excepción temporal GHSA-fc5q-39xc-vjpf hasta ${expires}: ${excepted.join(', ')}.`
      : 'Auditoría aprobada sin excepciones.');
  } catch (error) {
    console.error(`Auditoría bloqueada: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { evaluate };
