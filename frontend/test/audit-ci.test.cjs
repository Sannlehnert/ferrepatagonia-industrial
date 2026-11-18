const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../scripts/audit-ci.cjs');
const lock = require('../package-lock.json');

const finding = (name, severity = 'high') => ({
  name, severity, range: '*', isDirect: false, effects: [],
  nodes: [`node_modules/${name}`],
  via: [{ name, dependency: name, severity, range: '*',
    url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }],
});

function report(rows = []) {
  const vulnerabilities = Object.fromEntries(rows.map(row => [row.name, row]));
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: rows.length };
  for (const row of rows) counts[row.severity]++;
  return {
    status: Number(counts.high + counts.critical > 0),
    stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: {
      vulnerabilities: counts, dependencies: { prod: 75, dev: 179, optional: 45, peer: 1, peerOptional: 0, total: 254 },
    } }),
  };
}

const input = (overrides = {}) => ({
  production: report(), full: report(), lock: structuredClone(lock), ...overrides,
});

test('acepta informes completos sin hallazgos altos o críticos', () => {
  assert.doesNotThrow(() => evaluate(input()));
  assert.doesNotThrow(() => evaluate(input({ full: report([finding('picomatch', 'moderate')]) })));
});

test('bloquea hallazgos altos y críticos en producción o desarrollo sin excepciones', () => {
  for (const level of ['high', 'critical']) {
    const production = report([finding('axios', level)]);
    assert.throws(() => evaluate(input({ production, full: production })), /Producción tiene/);
    assert.throws(() => evaluate(input({ full: report([finding('picomatch', level)]) })), /completa tiene/);
  }
});

test('rechaza cuando la auditoría completa omite hallazgos de producción', () => {
  assert.throws(() => evaluate(input({ production: report([finding('axios', 'moderate')]) })), /omite hallazgos/);
});

test('bloquea fallos de npm, JSON inválido, resultados incompletos y estados inconsistentes', () => {
  for (const result of [
    { ...report(), status: null, error: new Error('timeout') },
    { ...report(), status: 2 },
    { ...report(), status: 1 },
    { ...report(), stdout: '{' },
    { ...report(), stdout: '{"auditReportVersion":2,"vulnerabilities":{}}' },
    report([{ ...finding('vite'), via: ['ausente'] }]),
    report([{ ...finding('vite'), via: ['picomatch'] }, { ...finding('picomatch'), via: ['vite'] }]),
  ]) {
    for (const field of ['production', 'full']) assert.throws(() => evaluate(input({ [field]: result })));
  }
});

test('rechaza inventarios contradictorios y nodos ajenos al lockfile', () => {
  for (const mutate of [
    data => Object.keys(data.metadata.dependencies).forEach(key => { data.metadata.dependencies[key] = 0; }),
    data => { data.metadata.dependencies.total++; },
    data => { data.metadata.dependencies.dev--; },
    data => { delete data.metadata.dependencies.peer; },
    data => { data.vulnerabilities.picomatch.nodes = ['node_modules/ausente']; },
  ]) {
    const full = report([finding('picomatch')]);
    const data = JSON.parse(full.stdout);
    mutate(data);
    full.stdout = JSON.stringify(data);
    assert.throws(() => evaluate(input({ full })), /inventario|incompleto/);
  }
});
