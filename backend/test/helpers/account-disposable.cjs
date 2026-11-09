const assert = require('node:assert/strict');
const disposable = require('./cc260-disposable.cjs');

const runner = 253;
const validateProfile = (profile, info) => disposable.validateProfile(profile, info, runner);
const childProfile = () => {
  assert.equal(process.env.NODE_ENV, 'test');
  return disposable.childProfile(runner);
};

async function assertOwned(session) {
  assert.equal(session?.runner, runner, 'Seed rechazado: sesión ajena al runner #253');
  await disposable.assertOwned(session);
}

function assertDatabaseOptions(session, dataSource) {
  const { host, port, database, password } = session.profile;
  const actual = dataSource.options;
  assert.ok(actual.host === host && actual.port === port && actual.database === database &&
    actual.username === 'root' && actual.password === password, 'DataSource ajeno al contenedor #253');
}

module.exports = {
  docker: disposable.docker,
  image: disposable.image,
  inspect: disposable.inspect,
  label: profile => disposable.label(profile, runner),
  assertContainerOwner: (profile, id, info) => disposable.assertContainerOwner(profile, id, info, runner),
  newProfile: () => disposable.newProfile(runner),
  connectOwned: profile => disposable.connectOwned(profile, runner),
  validateProfile, childProfile, assertOwned, assertDatabaseOptions,
};
