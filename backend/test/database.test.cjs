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
  else await assert.rejects(inTransaction(work), e => ['commit','rollback'].includes(failure) ? e.code === 'DATABASE_OUTCOME_UNKNOWN' : e === original);
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

test('uncertain result is explicit without leaking original query or credentials', () => {
 const { DatabaseOutcomeUnknownError, mutationErrorMessage } = require('../dist/config/database-policy');
 const error = new DatabaseOutcomeUnknownError();
 assert.match(mutationErrorMessage(error), /No se pudo confirmar/);
 assert.equal(mutationErrorMessage(Error('password=secret')), 'Error interno del servidor');
});

test('logger never serializes SQL parameters or arbitrary error messages', t => {
 const { SafeDatabaseLogger } = require('../dist/config/database-policy');
 const messages=[];
 for(const method of ['log','warn','error'])t.mock.method(console,method,(...args)=>messages.push(JSON.stringify(args)));
 const logger=new SafeDatabaseLogger();
 const secret='email@example.test password=secret jwt_token=secret $2b$12$synthetic';
 logger.logQuery('SELECT '+secret,[secret]);
 logger.logQueryError(secret,'SELECT '+secret,[secret]);
 logger.logQuerySlow(1200,'SELECT '+secret,[secret]);
 logger.log('warn',secret);logger.logMigration(secret);logger.logSchemaBuild(secret);
 assert.ok(messages.join(' ').includes('database.query.failed'));
 assert.ok(messages.join(' ').includes('database.query.slow'));
 assert.ok(!messages.join(' ').includes(secret));
});
