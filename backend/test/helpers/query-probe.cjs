const { before } = require('node:test');
const { dataSource } = require('../../dist/config/database.config');
// Real metadata and QueryBuilder; replace only its driver boundary, without sockets.
const probe = { query: async () => { throw Error('Unexpected database query'); } };
before(async () => {
 await dataSource.buildMetadatas();
 dataSource.createQueryRunner = () => ({
  query: async (sql, params) => ({ records: await probe.query(sql, params) }),
  release: async () => {}, isTransactionActive: false,
 });
});
module.exports = probe;
