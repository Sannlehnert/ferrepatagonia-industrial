const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newProfile, validateProfile, assertOwned } = require('./helpers/account-disposable.cjs');
const p = { ...newProfile(), id: 'a'.repeat(64), port: 49152 };
const info = { Id: p.id, Name: `/${p.container}`, Config: { Image: 'mariadb:11.4',
  Labels: { 'ferrepatagonia.account-test': p.token }, Env: [`MARIADB_DATABASE=${p.database}`, `MARIADB_ROOT_PASSWORD=${p.password}`] },
  State: { Running: true }, HostConfig: { AutoRemove: true, Tmpfs: { '/var/lib/mysql': 'rw' } },
  Mounts: [], NetworkSettings: { Ports: { '3306/tcp': [{ HostIp: p.host, HostPort: String(p.port) }] } } };

test('perfil descartable exacto aceptado', () => validateProfile(p, info));
for (const [name, mutate] of [
  ['host remoto', (p) => { p.host = 'db.example.com'; }],
  ['puerto ajeno', (p) => { p.port++; }],
  ['base compartida', (p) => { p.database = 'ferrepatagonia'; }],
  ['producción', (p) => { p.database = 'production'; }],
  ['ID ajeno', (p) => { p.id = 'b'.repeat(64); }],
  ['nombre ajeno', (p) => { p.container = 'mariadb'; }],
  ['ownership incorrecta', (_, i) => { i.Config.Labels = {}; }],
  ['imagen ajena', (_, i) => { i.Config.Image = 'mariadb:latest'; }],
  ['bind persistente', (_, i) => { i.Mounts = [{ Type: 'bind' }]; }],
  ['volumen persistente', (_, i) => { i.Mounts = [{ Type: 'volume' }]; }],
  ['puerto expuesto', (_, i) => { i.NetworkSettings.Ports['3306/tcp'][0].HostIp = '0.0.0.0'; }],
  ['sin limpieza automática', (_, i) => { i.HostConfig.AutoRemove = false; }],
]) test(`protección antes de conectar: rechaza ${name}`, () => {
  const profile = structuredClone(p), inspection = structuredClone(info);
  mutate(profile, inspection);
  assert.throws(() => validateProfile(profile, inspection));
});
test('seed rechaza sesión arbitraria antes de tocar SQL', async () => {
  let calls = 0;
  await assert.rejects(assertOwned({ connection: { query() { calls++; } }, profile: p }), /sesión ajena/);
  assert.equal(calls, 0);
});
