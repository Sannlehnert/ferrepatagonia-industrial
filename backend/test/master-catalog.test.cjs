const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { parseMasterCatalog, masterCsv } = require('../dist/scripts/import-master-catalog.js');

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
