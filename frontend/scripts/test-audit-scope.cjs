'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { evaluate, runAudits } = require('./audit-ci.cjs');
const frontend = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ferre-audit-scope-test-'));
const configurations = [
  { name: 'normal', env: {} },
  { name: 'NPM_CONFIG_OMIT=dev', env: { NPM_CONFIG_OMIT: 'dev' } },
  { name: 'npm_config_omit=dev', env: { npm_config_omit: 'dev' } },
  { name: 'NODE_ENV=production', env: { NODE_ENV: 'production' } },
  { name: '.npmrc fixture', env: {}, npmrc: 'omit[]=dev\nomit[]=optional\nomit[]=peer\nproduction=true\n' },
  { name: 'combinación', env: { NPM_CONFIG_OMIT: 'dev', NODE_ENV: 'production', npm_config_offline: 'true' },
    npmrc: 'omit[]=dev\naudit=false\n' },
];
const savedEnv = { ...process.env };
try {
  assert.ok(process.env.npm_execpath, 'Ejecutar mediante npm run test:audit-scope');
  assert.equal(process.versions.node, '22.22.2');
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(frontend, file), path.join(fixture, file));
  }
  fs.symlinkSync(path.join(frontend, 'node_modules'), path.join(fixture, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir');
  for (const configuration of configurations) {
    process.env = { ...savedEnv, ...configuration.env };
    fs.writeFileSync(path.join(fixture, '.npmrc'), configuration.npmrc ?? '');
    const results = runAudits(fixture, savedEnv.npm_execpath);
    const production = JSON.parse(results.production.stdout);
    const full = JSON.parse(results.full.stdout);
    assert.equal(results.production.status, 0);
    assert.equal(production.metadata.vulnerabilities.total, 0);
    assert.equal(results.full.status, 1);
    assert.equal(full.metadata.vulnerabilities.high, 10);
    assert.equal(evaluate({ ...results, now: Date.now() }).length, 10);
    console.log(`${configuration.name}: producción 0, completa 10 altas; excepción aplicada explícitamente.`);
  }
} finally {
  process.env = savedEnv;
  // Remove the fixture junction itself before removing the exclusively owned directory.
  const link = path.join(fixture, 'node_modules');
  if (fs.existsSync(link)) fs.unlinkSync(link);
  fs.rmSync(fixture, { recursive: true, force: true });
}
