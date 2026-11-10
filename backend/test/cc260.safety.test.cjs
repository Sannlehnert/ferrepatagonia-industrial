const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newProfile, validateProfile, assertOwned, childProfile } = require('./helpers/cc260-disposable.cjs');
const p = { ...newProfile(), id: 'a'.repeat(64), port: 49152 };
const info = { Id: p.id, Name: `/${p.container}`, Config: { Image: 'mariadb:11.4', Hostname: p.id.slice(0, 12),
  Labels: { 'ferrepatagonia.cc260-test': p.token }, Env: [`MARIADB_DATABASE=${p.database}`, `MARIADB_ROOT_PASSWORD=${p.password}`] },
  State: { Running: true }, HostConfig: { AutoRemove: true, Tmpfs: { '/var/lib/mysql': 'rw' },
    PortBindings: { '3306/tcp': [{ HostIp: p.host, HostPort: '' }] } },
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
  ['credenciales ajenas', (p) => { p.password='different'; }],
  ['contenedor parado', (_, i) => { i.State.Running=false; }],
  ['base creada diferente', (_, i) => { i.Config.Env[0]='MARIADB_DATABASE=shared'; }],
]) test(`protección antes de conectar: rechaza ${name}`, () => {
  const profile = structuredClone(p), inspection = structuredClone(info);
  mutate(profile, inspection);
  assert.throws(() => validateProfile(profile, inspection));
});
test('ALLOW_DEV_DB y un nombre seguro no sustituyen un perfil del runner',()=>{
  const old={...process.env};
  try{delete process.env.CC260_TEST_PROFILE;process.env.ALLOW_DEV_DB='true';process.env.CUENTA_CORRIENTE_TEST_DATABASE='audit_cc_'+'a'.repeat(32);assert.throws(childProfile,/test:cuenta-corriente/);}
  finally{for(const k of Object.keys(process.env))if(!Object.hasOwn(old,k))delete process.env[k];Object.assign(process.env,old);}
});
test('seed rechaza sesión arbitraria antes de tocar SQL', async () => {
  let calls = 0;
  await assert.rejects(assertOwned({ connection: { query() { calls++; } }, profile: p }), /sesión ajena/);
  assert.equal(calls, 0);
});

test('el perfil de pedidos rechaza un destino distinto aun con ALLOW_DEV_DB', () => {
  const keys = {
    CC260_TEST_PROFILE: JSON.stringify(p), DB_HOST: p.host, DB_PORT: String(p.port),
    DB_NAME: 'ferrepatagonia_dev', DB_USER: 'root', DB_PASSWORD: p.password, ALLOW_DEV_DB: 'true',
  };
  const previous = Object.keys(keys).map(key => [key, process.env[key]]);
  try {
    Object.assign(process.env, keys);
    assert.throws(childProfile, /ferrepatagonia_dev/);
    process.env.DB_NAME = p.database;
    process.env.DB_PORT = '3307';
    assert.throws(childProfile, /3307/);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
