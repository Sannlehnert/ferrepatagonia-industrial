const assert = require('node:assert/strict');
const { before, after } = require('node:test');
// Refuse all external databases, even when an old opt-in variable is set.
assert.match(process.env.DB_NAME || '', /^(admin_products|categories)_test_[a-f0-9]{32}$/);
assert.equal(process.env.DB_HOST, '127.0.0.1');
const { initializeDatabase, dataSource } = require('../../dist/config/database.config');
before(initializeDatabase);
after(async () => { if (dataSource.isInitialized) await dataSource.destroy(); });
