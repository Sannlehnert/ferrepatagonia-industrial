const creditTables = ['SOLICITUD_CREDITO', 'EVENTO_CREDITO'];
const baseTables = [
    'CARRITO', 'CATEGORIA', 'CLIENTE', 'COMPROBANTE_PAGO', 'CONFIRMACION_PEDIDO_CC',
    'CONFIRMACION_PEDIDO_TRANSFERENCIA', 'COTIZACION', 'CUENTA_CORRIENTE', 'DETALLE_PEDIDO',
    'DETALLE_PEDIDO_CC_PRECIO', 'FER17_CALENDARIO', 'FER17_COTIZACION_VERIFICACION',
    'FER17_LISTA_INACTIVA_EVENTO', 'FER17_PRECIO_EVENTO', 'IMPUTACION_MOVIMIENTO_CUENTA',
    'ITEM_CARRITO', 'LISTA_PRECIO', 'MOVIMIENTO_CUENTA_CORRIENTE', 'PAGO', 'PEDIDO',
    'PRECIO_USD_EVIDENCIA', 'PRODUCTO', 'USUARIO',
];
const fer20 = [
    'fer260_cuenta_revision:CUENTA_CORRIENTE:BEFORE:UPDATE',
    'fer260_imputacion_insert:IMPUTACION_MOVIMIENTO_CUENTA:BEFORE:INSERT',
    'fer260_imputacion_update:IMPUTACION_MOVIMIENTO_CUENTA:BEFORE:UPDATE',
];
const fer17 = [
    'fer17_precio_evento_no_delete:FER17_PRECIO_EVENTO:BEFORE:DELETE',
    'fer17_precio_evento_no_update:FER17_PRECIO_EVENTO:BEFORE:UPDATE',
    'fer17_producto_alta_evento:PRODUCTO:AFTER:INSERT',
    'fer17_producto_precio_evento:PRODUCTO:AFTER:UPDATE',
];
const s704 = [
    's704_comprobante_before_update:COMPROBANTE_PAGO:BEFORE:UPDATE',
    's704_movimiento_before_delete:MOVIMIENTO_CUENTA_CORRIENTE:BEFORE:DELETE',
    's704_movimiento_before_update:MOVIMIENTO_CUENTA_CORRIENTE:BEFORE:UPDATE',
    's704_pago_before_delete:PAGO:BEFORE:DELETE',
    's704_pago_before_insert:PAGO:BEFORE:INSERT',
    's704_pago_before_update:PAGO:BEFORE:UPDATE',
];
const priceViews = ['FER17_AUDITORIA_TRIGGERS'];
const profiles = {
    // Suites that install only FER-20 intentionally have no price triggers or view.
    'fer20-only': { tables: [...baseTables, ...creditTables], triggers: fer20, views: [] },
    'before-credit': { tables: baseTables, triggers: [...fer20, ...fer17, ...s704], views: priceViews },
    complete: { tables: [...baseTables, ...creditTables], triggers: [...fer20, ...fer17, ...s704], views: priceViews },
};

async function readSchemaInventory(query) {
    const rows = await query(`
        SELECT TABLE_NAME AS name, TABLE_TYPE AS type
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
    `);
    const triggers = await query(`
        SELECT CONCAT_WS(':', TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION) AS signature
        FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
    `);
    return {
        tables: rows.filter(row => row.type === 'BASE TABLE').map(row => row.name).sort(),
        triggers: triggers.map(row => row.signature).sort(),
        views: rows.filter(row => row.type === 'VIEW').map(row => row.name).sort(),
    };
}

function schemaErrors(actual, profile) {
    const expected = profiles[profile];
    return Object.keys(expected).flatMap(key => {
        const missing = expected[key].filter(value => !actual[key].includes(value));
        const extra = actual[key].filter(value => !expected[key].includes(value));
        return [
            ...(missing.length ? [`${key} faltantes: ${missing.join(', ')}.`] : []),
            ...(extra.length ? [`${key} no reconocidos: ${extra.join(', ')}.`] : []),
        ];
    });
}

module.exports = { creditTables, readSchemaInventory, schemaErrors };
