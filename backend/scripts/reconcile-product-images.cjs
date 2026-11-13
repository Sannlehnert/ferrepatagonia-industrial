const { readdir, unlink } = require('node:fs/promises');
const { join } = require('node:path');
const { dataSource, initializeDatabase, destroyDatabase } = require('../dist/config/database.config');
const { productImageDirectory } = require('../dist/services/productImage.service');
const { isProductImageName, productImageName, productImagePrefix } = require('../dist/utils/product-image');

async function main() {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--apply-offline')) {
        throw new Error('Modo válido: sin argumentos o --apply-offline.');
    }
    const apply = args[0] === '--apply-offline';
    const root = await productImageDirectory();
    await initializeDatabase();
    const rows = await dataSource.query('SELECT imagen FROM PRODUCTO WHERE imagen LIKE ?', [productImagePrefix + '%']);
    const referenced = new Set(rows.map(row => productImageName(row.imagen)).filter(Boolean));
    const present = new Set();
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile() || !isProductImageName(entry.name)) continue;
        present.add(entry.name);
        if (referenced.has(entry.name)) continue;
        if (apply) await unlink(join(root, entry.name));
        console.log((apply ? 'Eliminada: ' : 'Sin referencia: ') + entry.name);
    }
    for (const name of referenced) {
        if (!present.has(name)) {
            console.error('Falta el archivo referenciado: ' + name);
            process.exitCode = 1;
        }
    }
}

main().catch(() => {
    console.error('No se pudo completar la conciliación de fotos de productos.');
    process.exitCode = 1;
}).finally(destroyDatabase);
