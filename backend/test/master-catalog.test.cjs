const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseMasterCatalog, masterCsv, triggerBodiesEquivalent } = require('../dist/scripts/import-master-catalog.js');

const csv = readFileSync(masterCsv, 'utf8');

test('el CSV versionado contiene 100 SKU originales y ocho categorías', () => {
  const rows = parseMasterCatalog(csv);
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map(row => row.sku)).size, 100);
  assert.equal(new Set(rows.map(row => row.category)).size, 8);
  assert.equal(rows[0].sku, 'FP-DEMO-ABR-DISCO-LIJA-100-MM');
  assert.equal(rows[0].stock, 48);
  assert.match(rows[0].description, /Diámetro|diámetro/);
  assert.match(rows[0].description, /Presentación:/);
});

test('rechaza lotes incompletos, duplicados, campos inválidos y CSV mal formado', () => {
  for (const bad of [
    csv.split(/\r?\n/).slice(0, 100).join('\n'),
    csv.replace('FP-DEMO-ABR-DISCO-METAL-100-MM', 'FP-DEMO-ABR-DISCO-LIJA-100-MM'),
    csv.replace('"48","1.68"', '"-1","1.68"'),
    csv.replace('"48","1.68"', '"2147483648","1.68"'),
    csv.replace('"48","1.68"', '"","1.68"'),
    csv.replace('"sku"', '"categoria"'),
    csv.replace('"2","FP-DEMO', '"2,"FP-DEMO')
  ]) {
    assert.notEqual(bad, csv);
    assert.throws(() => parseMasterCatalog(bad), /CSV inválido|Fila de catálogo inválida/);
  }
});

test('compara el trigger FER-17 sin ocultar literales ni identificadores', () => {
  const migration = readFileSync(
    resolve(__dirname, '../../database/migrate-fer-17-price-verification.sql'), 'utf8');
  const canonical = migration.match(
    /CREATE OR REPLACE TRIGGER fer17_producto_alta_evento\s+AFTER INSERT ON PRODUCTO\s+FOR EACH ROW\s+([\s\S]+?)\/\//
  )?.[1];
  assert.ok(canonical);
  const lowercaseKeywords = canonical.replace(
    /\b(BEGIN|DECLARE|DEFAULT|SET|SELECT|FROM|WHERE|AND|LIMIT|INSERT|INTO|VALUES|END|NULL|NEW|OLD)\b/g,
    keyword => keyword.toLowerCase());
  const spaced = canonical.replace(/,\s*/g, ' ,   ').replace(/=/g, '  =  ');
  assert.notEqual(lowercaseKeywords, canonical);
  assert.notEqual(spaced, canonical);

  assert.equal(triggerBodiesEquivalent(canonical, canonical), true);
  assert.equal(triggerBodiesEquivalent(canonical, lowercaseKeywords), true);
  assert.equal(triggerBodiesEquivalent(canonical, spaced), true);
  assert.equal(triggerBodiesEquivalent(canonical, canonical.replace("'ALTA'", "'BAJA'")), false);
  assert.equal(triggerBodiesEquivalent(canonical, canonical.replace("'ALTA'", "'alta'")), false);
  assert.equal(triggerBodiesEquivalent(canonical, canonical.replace('NEW.precio', 'OLD.precio')), false);
  assert.equal(triggerBodiesEquivalent("INSERT INTO t VALUES ('ALTA')", "insert into t values ('ALTA')"), true);
  assert.equal(triggerBodiesEquivalent("INSERT INTO `T` VALUES ('ALTA')", "insert into `t` values ('ALTA')"), false);
  assert.equal(triggerBodiesEquivalent('SELECT 1 WHERE a = 1 AND b = 2', 'select 1 where a = 1 or b = 2'), false);
});
