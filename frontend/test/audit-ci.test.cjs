const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../scripts/audit-ci.cjs');
const lock = require('../package-lock.json');

const advisory = (name, url = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', severity = 'high') =>
  ({ name, dependency: name, url, severity, range: '<=4.0.7' });
const other = (name, severity) => advisory(name, 'https://github.com/advisories/GHSA-1111-2222-3333', severity);
const finding = (name, via, severity = 'high') =>
  ({ name, via, severity, range: '*', isDirect: false, effects: [], nodes: [`node_modules/${name}`] });

function report(rows = []) {
  const vulnerabilities = Object.fromEntries(rows.map(row => [row.name, { ...row, effects: [] }]));
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: rows.length };
  for (const row of Object.values(vulnerabilities)) {
    counts[row.severity]++;
    for (const cause of row.via) {
      if (typeof cause === 'string' && vulnerabilities[cause]) vulnerabilities[cause].effects.push(row.name);
    }
  }
  return {
    status: Number(counts.high + counts.critical > 0),
    stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: {
      vulnerabilities: counts, dependencies: { prod: 75, dev: 179, optional: 45, peer: 1, peerOptional: 0, total: 254 },
    } }),
  };
}

function baseline() {
  return [
    finding('picomatch', [advisory('picomatch')]),
    finding('@vue/language-core', ['picomatch']),
    finding('fdir', ['picomatch']),
    finding('npm-run-all2', ['picomatch']),
    finding('tinyglobby', ['fdir', 'picomatch']),
    finding('unplugin-utils', ['picomatch']),
    finding('vite', ['picomatch', 'tinyglobby']),
    finding('vite-plugin-inspect', ['unplugin-utils']),
    finding('vite-plugin-vue-devtools', ['vite-plugin-inspect']),
    finding('vue-tsc', ['@vue/language-core']),
  ];
}

const input = (overrides = {}) => ({
  production: report(), full: report(baseline()), lock: structuredClone(lock),
  now: Date.parse('2026-11-23T23:59:59.999Z'), ...overrides,
});

test('permite únicamente los diez hallazgos de desarrollo revisados antes del vencimiento UTC', () => {
  assert.equal(evaluate(input()).length, 10);
  const npm10 = report(baseline());
  const data = JSON.parse(npm10.stdout);
  data.vulnerabilities.fdir.effects = [];
  data.vulnerabilities.tinyglobby.effects = [];
  npm10.stdout = JSON.stringify(data);
  assert.equal(evaluate(input({ full: npm10 })).length, 10);
  assert.deepEqual(evaluate(input({ full: report(), now: Date.parse('2026-11-25') })), []);
});

test('bloquea cualquier advisory alto o crítico ajeno, directo o en la cadena exceptuada', () => {
  for (const level of ['high', 'critical']) {
    const extra = finding('otro', [other('otro', level)], level);
    assert.throws(() => evaluate(input({ full: report([...baseline(), extra]) })), /fuera del conjunto/);
    assert.throws(() => evaluate(input({ production: report([extra]) })), /Producción tiene/);
  }
  const moderate = finding('otro', [other('otro', 'moderate')], 'moderate');
  assert.throws(() => evaluate(input({ full: report([...baseline(), moderate]) })), /hallazgos nuevos/);
  assert.deepEqual(evaluate(input({ full: report([moderate]) })), []);
  for (const name of ['picomatch', 'vite']) {
    const rows = baseline();
    rows.find(row => row.name === name).via.push(other(name, 'moderate'));
    assert.throws(() => evaluate(input({ full: report(rows) })), /no autorizada/);
  }
});

test('invalida la excepción al cambiar versión, introducir una copia o alcanzar producción', () => {
  const version = input();
  version.lock.packages['node_modules/picomatch'].version = '4.0.8';
  assert.throws(() => evaluate(version), /una sola instalación/);
  const nested = input();
  nested.lock.packages['node_modules/otro/node_modules/picomatch'] = { version: '4.0.7', dev: true };
  assert.throws(() => evaluate(nested), /una sola instalación/);
  const prod = input();
  delete prod.lock.packages['node_modules/picomatch'].dev;
  assert.throws(() => evaluate(prod), /de desarrollo/);
  const prodEdge = input();
  prodEdge.lock.packages[''].dependencies.picomatch = '^4.0.7';
  assert.throws(() => evaluate(prodEdge), /alcanza dependencias de producción/);
});

test('invalida rutas y nodos distintos del lockfile o del informe', () => {
  const changed = input();
  changed.lock.packages['node_modules/vite'].dependencies.picomatch = '4.0.7';
  assert.throws(() => evaluate(changed), /Cambió el árbol/);
  const rows = baseline();
  rows.find(row => row.name === 'vite').via = ['picomatch'];
  assert.throws(() => evaluate(input({ full: report(rows) })), /alcance autorizado|no autorizada/);
});

test('bloquea a partir de las 00:00 UTC del 24 de noviembre', () => {
  assert.throws(() => evaluate(input({ now: Date.parse('2026-11-24T00:00:00Z') })), /venció/);
});

test('bloquea fallos de npm, JSON inválido, resultados incompletos y estados inconsistentes', () => {
  for (const result of [
    { ...report(), status: null, error: new Error('timeout') },
    { ...report(), status: 2 },
    { ...report(), status: 1 },
    { ...report(), stdout: '{' },
    { ...report(), stdout: '{"auditReportVersion":2,"vulnerabilities":{}}' },
    report([finding('vite', ['ausente'])]),
    report([finding('vite', ['otro']), finding('otro', ['vite'])]),
  ]) {
    for (const field of ['production', 'full']) assert.throws(() => evaluate(input({ [field]: result })));
  }
});
