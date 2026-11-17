const assert = require('node:assert/strict');
const { readSchemaInventory, schemaErrors } = require('../../scripts/lib/schema-inventory.cjs');

async function assertSchemaInventory(query, profile) {
    const inventory = await readSchemaInventory(query);
    assert.deepEqual(schemaErrors(inventory, profile), [], `Inventario SQL del perfil ${profile}`);
    if (profile !== 'fer20-only') {
        const rows = await query('SELECT vigente FROM FER17_AUDITORIA_TRIGGERS');
        assert.deepEqual(rows.map(row => Number(row.vigente)), [1, 1, 1, 1], 'Guardias de precio vigentes');
    }
    return { profile, tables: inventory.tables.length, triggers: inventory.triggers.length, views: inventory.views.length };
}

module.exports = { assertSchemaInventory };
