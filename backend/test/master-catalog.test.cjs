const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  parseMasterCatalog, masterCsv, triggerBodiesEquivalent, expectedFer17Triggers,
  demoServerReasons, masterCatalogLockName,
} = require('../dist/scripts/import-master-catalog.js');

const csv = readFileSync(masterCsv, 'utf8');
const migration = readFileSync(
  resolve(__dirname, '../../database/migrate-fer-17-price-verification.sql'), 'utf8');

test('el CSV versionado contiene 100 SKU originales y ocho categorías', () => {
  const rows = parseMasterCatalog(csv);
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map(row => row.sku)).size, 100);
  assert.equal(new Set(rows.map(row => row.category)).size, 8);
  assert.equal(rows[0].sku, 'FP-DEMO-ABR-DISCO-LIJA-100-MM');
  assert.equal(rows[0].stock, 48);
  assert.equal(rows[0].description, 'Disco abrasivo para tareas de lijado.');
  assert.equal(rows[0].referencePrice, '1.68');
  assert.doesNotMatch(rows[0].description, /Ficha original|Variante original|académico/);
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
  assert.equal(triggerBodiesEquivalent("INSERT INTO `T` VALUES ('ALTA')", "insert into `t` values ('ALTA')"), true);
  assert.equal(triggerBodiesEquivalent('SELECT 1 WHERE a = 1 AND b = 2', 'select 1 where a = 1 or b = 2'), false);
});

test('tokeniza comentarios, comentarios ejecutables y backticks sin alterar la semántica', () => {
  // "--" only starts a comment when followed by whitespace or a control char.
  assert.equal(triggerBodiesEquivalent('SELECT 1--1', 'SELECT 1'), false);
  assert.equal(triggerBodiesEquivalent('SELECT 1--1', 'SELECT 1 - -1'), true);
  assert.equal(triggerBodiesEquivalent('SELECT 1 -- comentario', 'SELECT 1'), true);
  assert.equal(triggerBodiesEquivalent('SELECT 1 --comentario', 'SELECT 1 - -comentario'), true);
  assert.equal(triggerBodiesEquivalent('SELECT 1#comentario', 'SELECT 1'), true);

  // MariaDB executable comments are code and must never be discarded.
  const executable = 'BEGIN SET @v = 1 /*M!100100 + 2 */; END';
  assert.equal(triggerBodiesEquivalent(executable, executable), true);
  assert.equal(triggerBodiesEquivalent(executable, 'BEGIN SET @v = 1; END'), false);
  assert.equal(triggerBodiesEquivalent(executable, 'BEGIN SET @v = 1 /*M!100100 + 3 */; END'), false);
  assert.equal(triggerBodiesEquivalent('BEGIN /*!40101 SET @v = 1 */ END',
    'BEGIN /*!40101 SET @v = 1 */ END'), true);
  assert.equal(triggerBodiesEquivalent('BEGIN /*!40101 SET @v = 1 */ END',
    'BEGIN /*!40101 SET @v = 2 */ END'), false);

  // Backticks around a simple identifier do not change the object.
  assert.equal(triggerBodiesEquivalent('INSERT INTO `t` (`a`) VALUES (1)',
    'insert into t (a) values (1)'), true);
  assert.equal(triggerBodiesEquivalent('SELECT `con espacio` FROM t',
    'SELECT `con espacio` FROM t'), true);
  assert.equal(triggerBodiesEquivalent('SELECT `con espacio` FROM t',
    'SELECT `otro espacio` FROM t'), false);
  // A quoted identifier is never confused with a keyword.
  assert.equal(triggerBodiesEquivalent('SELECT `select` FROM t', 'SELECT select FROM t'), false);

  // Identifiers (columns, aliases, variables) compare case-insensitively;
  // literals and keywords remain distinct.
  assert.equal(triggerBodiesEquivalent('SELECT NEW.Precio FROM USUARIO U',
    'select new.precio from usuario u'), true);
  assert.equal(triggerBodiesEquivalent("SET @Mensaje = 'ALTA'", "set @mensaje = 'ALTA'"), true);
  assert.equal(triggerBodiesEquivalent('SIGNAL SQLSTATE \'45000\'', 'SIGNAL SQLSTATE \'45001\''), false);
  assert.equal(triggerBodiesEquivalent('UPDATE t SET a = 1', 'DELETE FROM t'), false);
});

test('la auditoría FER-17 exige las cuatro definiciones versionadas', () => {
  const triggers = expectedFer17Triggers(migration);
  assert.deepEqual(triggers.map(trigger => trigger.name), [
    'fer17_producto_alta_evento', 'fer17_producto_precio_evento',
    'fer17_precio_evento_no_update', 'fer17_precio_evento_no_delete',
  ]);
  assert.deepEqual(triggers.map(trigger => `${trigger.timing} ${trigger.event} ${trigger.table}`), [
    'AFTER INSERT PRODUCTO', 'AFTER UPDATE PRODUCTO',
    'BEFORE UPDATE FER17_PRECIO_EVENTO', 'BEFORE DELETE FER17_PRECIO_EVENTO',
  ]);
  for (const trigger of triggers) assert.ok(trigger.body.trim().length > 0);
  assert.throws(() => expectedFer17Triggers(migration.replace(
    /CREATE OR REPLACE TRIGGER fer17_precio_evento_no_delete[\s\S]*?END\/\//, '')), /triggers obligatorios/);
});

test('la guarda DEMO clasifica base, servidor y usuario sin falsos negativos', () => {
  assert.deepEqual(demoServerReasons({ database: 'ferrepatagonia', hostname: 'produccion-01', users: ['app'] }), []);
  assert.equal(demoServerReasons({
    database: 'FERRE_DEMO_286', hostname: 'host', users: ['app'],
  }).length, 1);
  assert.equal(demoServerReasons({
    database: 'e2e_test_catalogo', hostname: 'host', users: ['app'],
  }).length, 1);
  assert.equal(demoServerReasons({
    database: 'ferrepatagonia', hostname: 'DEMO286-auditoria', users: ['app'],
  }).length, 1);
  assert.equal(demoServerReasons({
    database: 'ferrepatagonia', hostname: 'host', users: ['app', 'DEMO286'],
  }).length, 1);
  assert.equal(demoServerReasons({
    database: 'ferre_demo_x', hostname: 'demo286-x', users: ['demo286'],
  }).length, 3);
});

test('el bloqueo cooperativo depende de la base y respeta el límite de MariaDB', () => {
  const first = masterCatalogLockName('ferrepatagonia');
  assert.equal(first, masterCatalogLockName('ferrepatagonia'));
  assert.notEqual(first, masterCatalogLockName('otra_base'));
  assert.match(first, /^ferre\.s7\.catalogo\.[0-9a-f]{40}$/);
  assert.ok(first.length <= 64);
});

test('313: referencias compiladas coinciden con los 100 importes y solo autorizan su SKU e importe exactos', () => {
  const { catalogReferencePrices, catalogReferenceVersion, catalogReferenceEvidence, isCatalogReference, catalogReferenceSql } = require('../dist/services/pricing/catalog-reference');
  const { calculateLine } = require('../dist/services/pricing/pricing.engine');
  const { parsePriceRequest } = require('../dist/services/pricing/pricing.service');
  const rows = parseMasterCatalog(csv);
  assert.equal(Object.keys(catalogReferencePrices).length, 100);
  assert.equal(catalogReferenceVersion, require('node:crypto').createHash('sha256').update(JSON.stringify(Object.fromEntries(rows.map(row=>[row.sku,row.referencePrice])))).digest('hex'));
  for (const row of rows) {
    const evidence = catalogReferenceEvidence(row.sku);
    assert.equal(catalogReferencePrices[row.sku], row.referencePrice);
    assert.equal(isCatalogReference(row.sku, row.referencePrice, evidence, 1), true);
    assert.equal(isCatalogReference(row.sku.toLowerCase(), row.referencePrice, evidence, 1), false);
    assert.equal(isCatalogReference(row.sku, '999.99', evidence, 1), false);
    assert.equal(isCatalogReference(row.sku, row.referencePrice, 'SINTETICO ACADEMICO #286 SHA256:' + '0'.repeat(64), 1), false);
    assert.equal(isCatalogReference(row.sku, row.referencePrice, evidence, 0), false);
    const product = { id:1, baseUSD:row.referencePrice, specialPercent:null, baseVerified:true, catalogReference:true,
      evidence:{reference:evidence,verifiedAt:new Date().toISOString(),synthetic:true} };
    for (const discount of ['0.00','10.00','20.00']) {
      const line = calculateLine(product, {productoId:1,cantidad:3}, discount);
      const cents = BigInt(row.referencePrice.replace('.',''));
      const pct = BigInt(discount.replace('.',''));
      const expected = (cents*(10000n-pct)+5000n)/10000n;
      assert.equal(line.precioUnitarioUSD, (expected/100n)+'.'+String(expected%100n).padStart(2,'0'));
      assert.equal(line.referenciaCatalogo, true);
      assert.equal(line.evidenciaBaseUSD.synthetic, true, 'Se conserva la procedencia representativa');
    }
  }
  assert.throws(()=>catalogReferenceEvidence('SKU-AJENO'));
  assert.throws(()=>catalogReferenceSql('p;DROP TABLE PRODUCTO','e'));
  assert.throws(()=>parsePriceRequest({moneda:'USD',productos:[{productoId:1,cantidad:1,referenciaCatalogo:true}]}));
  assert.throws(()=>parseMasterCatalog(csv.replace('"48","1.68","1.68"','"48","1.68","0.00"')));
});
