const assert = require('node:assert/strict');
const { test } = require('node:test');
Object.assign(process.env, { JWT_SECRET: 'unit', DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'unit', DB_USER: 'unit', DB_PASSWORD: 'unit' });
const { dataSource, inTransaction } = require('../dist/config/database.config');
for (const failure of ['none', 'start', 'work', 'commit', 'rollback']) {
 test('transaction lifecycle: ' + failure, async t => {
  const events = [], manager = {}, original = Error('original');
  const native = { destroy() { events.push('destroy'); } };
  const runner = { manager, isTransactionActive: false,
   async connect() { events.push('connect'); return native; },
   async startTransaction() { events.push('start'); if (failure === 'start') throw original; this.isTransactionActive = true; },
   async commitTransaction() { events.push('commit'); if (failure === 'commit') throw original; this.isTransactionActive = false; },
   async rollbackTransaction() { events.push('rollback'); if (failure === 'rollback') throw Error('rollback failed'); this.isTransactionActive = false; },
   async release() { events.push('release'); },
  };
  t.mock.method(dataSource, 'createQueryRunner', () => runner);
  const work = m => { assert.equal(m, manager); events.push('work'); if (['work', 'rollback'].includes(failure)) throw original; return Promise.resolve(42); };
  if (failure === 'none') assert.equal(await inTransaction(work), 42);
  else await assert.rejects(inTransaction(work), e => e === original);
  const expected = {
   none: ['connect','start','work','commit','release'],
   start: ['connect','start','destroy','release'],
   work: ['connect','start','work','rollback','release'],
   commit: ['connect','start','work','commit','rollback','release'],
   rollback: ['connect','start','work','rollback','destroy','release'],
  };
  assert.deepEqual(events, expected[failure]);
 });
}
