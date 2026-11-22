// Sincroniza únicamente el manifiesto compilado; no conecta a MariaDB.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Papa = require('papaparse');
const root = path.resolve(__dirname, '../..');
const parsed = Papa.parse(fs.readFileSync(path.join(root, 'docs/309/catalogo-maestro.csv'), 'utf8'), { header:true, skipEmptyLines:true });
const prices = Object.fromEntries(parsed.data.map(row => [row.sku, row.precio_referencia_usd]));
if (parsed.errors.length || parsed.data.length !== 100 || Object.keys(prices).length !== 100 ||
  Object.entries(prices).some(([sku,amount]) => !/^FP-DEMO-[A-Z0-9-]+$/.test(sku) || !/^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(amount) || Number(amount)<=0)) throw Error('Inventario de referencias inválido.');
const version = createHash('sha256').update(JSON.stringify(prices)).digest('hex');
const file = path.join(root, 'backend/src/services/pricing/catalog-reference.ts');
const source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('export const catalogReferencePrices:');
const end = source.indexOf('const prefix =');
if (start < 0 || end < start) throw Error('No se reconoce el manifiesto de referencias.');
if (process.argv.includes('--check')) {
  const stored = Object.fromEntries([...source.slice(start,end).matchAll(/['"](FP-DEMO-[A-Z0-9-]+)['"]:\s*['"]([0-9]+\.[0-9]{2})['"]/g)].map(match=>[match[1],match[2]]));
  if (JSON.stringify(stored)!==JSON.stringify(prices) || !source.includes(version)) throw Error('El manifiesto no coincide con #309.');
} else {
  const manifest = 'export const catalogReferencePrices: Readonly<Record<string, string>> = Object.freeze({\n' +
    Object.entries(prices).map(([sku,amount]) => '  '+JSON.stringify(sku)+': '+JSON.stringify(amount)+',').join('\n') +
    '\n});\nexport const catalogReferenceVersion = '+JSON.stringify(version)+';\n';
  fs.writeFileSync(file, source.slice(0,start)+manifest+source.slice(end));
}
console.log('100 referencias verificadas: '+version);
