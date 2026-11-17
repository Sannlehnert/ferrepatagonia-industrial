const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { applySql } = require('./helpers/mariadb-cli.cjs');

const databaseDir = path.resolve(__dirname, '../../database');
const migrationFile = path.join(databaseDir, 'migrate-fer-17-price-verification.sql');

test('applySql envía el SQL original al cliente MariaDB por stdin', () => {
  const calls = [];
  const docker = (command, args, options) => {
    calls.push({ command, args, options });
    return Buffer.alloc(0);
  };
  const sql = fs.readFileSync(migrationFile);

  applySql({ container: 'pricing-test', password: 'secret', database: 'pricing_test', sql, docker });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'docker');
  assert.deepEqual(calls[0].args, [
    'exec', '-i', 'pricing-test', 'mariadb', '--protocol=socket', '--skip-ssl', '-uroot', '-psecret', 'pricing_test',
  ]);
  assert.ok(Buffer.isBuffer(calls[0].options.input));
  assert.ok(calls[0].options.input.equals(sql), 'El SQL debe llegar intacto, sin reinterpretar DELIMITER ni END//');
});

test('el runner de pricing usa el cargador sin transformar los delimitadores', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'helpers/run-pricing-mariadb.cjs'), 'utf8');
  assert.match(runner, /require\('\.\/mariadb-cli\.cjs'\)/, 'El runner debe usar el cliente MariaDB del contenedor');
  assert.doesNotMatch(runner, /\.replace\s*\(/, 'El runner no debe transformar el SQL de las migraciones');
});

test('la migración FER-17 declara los cuatro triggers completos con delimitadores nativos', () => {
  const sql = fs.readFileSync(migrationFile, 'utf8');
  assert.match(sql, /^DELIMITER \/\/$/m);
  assert.match(sql, /^CREATE OR REPLACE TRIGGER fer17_producto_alta_evento\r?\nAFTER INSERT ON PRODUCTO$/m);
  assert.match(sql, /^CREATE OR REPLACE TRIGGER fer17_producto_precio_evento\r?\nAFTER UPDATE ON PRODUCTO$/m);
  assert.match(sql, /^CREATE OR REPLACE TRIGGER fer17_precio_evento_no_update\r?\nBEFORE UPDATE ON FER17_PRECIO_EVENTO$/m);
  assert.match(sql, /^CREATE OR REPLACE TRIGGER fer17_precio_evento_no_delete\r?\nBEFORE DELETE ON FER17_PRECIO_EVENTO$/m);
  assert.equal((sql.match(/^END\/\/$/gm) ?? []).length, 4);
  assert.match(sql, /^DELIMITER ;$/m);
});
