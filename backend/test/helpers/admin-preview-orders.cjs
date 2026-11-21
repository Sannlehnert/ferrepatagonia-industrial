'use strict';

const assert = require('node:assert/strict');
const { connectOwned, assertOwned } = require('./cc260-disposable.cjs');
const marker = 'UI-PREVIEW-348: fixture temporal de pedidos; no es una compra ni un pago real';

// Solo admite perfiles E2E con identidad Docker, puerto aleatorio y tmpfs verificados.
// No carga .env ni permite apuntar a una base persistente.
async function seedAdminPreviewOrders(profile) {
  const session = await connectOwned(profile, 'E2E');
  const db = session.connection;
  try {
    await assertOwned(session);
    const [existing] = await db.query('SELECT COUNT(*) AS total FROM PEDIDO WHERE observaciones = ?', [marker]);
    if (Number(existing.total)) return Number(existing.total);
    const products = await db.query('SELECT id_producto, precio FROM PRODUCTO WHERE activo = 1 AND precio > 0 ORDER BY id_producto LIMIT 2');
    assert.equal(products.length, 2, 'La vista previa requiere dos productos cargados');
    const names = ['Suministros del Sur SRL', 'Taller Andino', 'Instalaciones Comahue', 'Mariana López'];
    const states = ['CONFIRMADO', 'EN_PREPARACION', 'ENVIADO', 'ENTREGADO'];
    await db.beginTransaction();
    try {
      const clients = [];
      for (let i = 0; i < names.length; i++) {
        const company = i < 3;
        const result = await db.query(`
          INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, estado_aprobacion_empresa, activo, es_fiel)
          VALUES (?, ?, ?, 1, 0)
        `, [company ? 'EMPRESA' : 'PARTICULAR', names[i], company ? 'APROBADA' : null]);
        clients.push(Number(result.insertId));
      }
      for (let i = 0; i < 24; i++) {
        const quantities = [1 + i % 3, 2];
        const cents = products.map(product => Math.round(Number(product.precio) * 100));
        const subtotals = cents.map((price, line) => price * quantities[line]);
        const total = (subtotals.reduce((sum, value) => sum + value, 0) / 100).toFixed(2);
        const order = await db.query(`
          INSERT INTO PEDIDO (id_cliente, fecha_utc, estado, modalidad_pago, moneda_total, subtotal, descuento, total, observaciones)
          VALUES (?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR), ?, 'TRANSFERENCIA', 'USD', ?, 0, ?, ?)
        `, [clients[i % clients.length], i * 3, states[i % states.length], total, total, marker]);
        for (let line = 0; line < products.length; line++) {
          await db.query(`
            INSERT INTO DETALLE_PEDIDO (id_pedido, id_producto, cantidad, precio_unitario, descuento, subtotal)
            VALUES (?, ?, ?, ?, 0, ?)
          `, [order.insertId, products[line].id_producto, quantities[line], (cents[line] / 100).toFixed(2), (subtotals[line] / 100).toFixed(2)]);
        }
      }
      await db.commit();
      return 24;
    } catch (error) {
      await db.rollback();
      throw error;
    }
  } finally { await db.end(); }
}

async function seedAdminPreviewReceipts(profile, directory) {
  const session = await connectOwned(profile, 'E2E');
  const db = session.connection;
  const fs = require('node:fs');
  const path = require('node:path');
  const { randomUUID, createHash } = require('node:crypto');
  const written = [];
  try {
    await assertOwned(session);
    const root = fs.realpathSync(directory);
    const relative = path.relative(fs.realpathSync(require('node:os').tmpdir()), root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.match(path.basename(root), /^ferre-receipts-e2e-/);
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    const rows = await db.query('SELECT id_pedido, id_cliente, total FROM PEDIDO WHERE observaciones = ? ORDER BY id_pedido', [marker]);
    assert.equal(rows.length, 24);
    const [admin] = await db.query("SELECT id_usuario FROM USUARIO WHERE rol = 'ADMIN' AND activo = 1 ORDER BY id_usuario LIMIT 1");
    assert.ok(admin);
    const hash = await require('bcryptjs').hash(randomUUID(), 10);
    const { PDFDocument } = require('pdf-lib');
    let count = 0;
    await db.beginTransaction();
    try {
      for (let i = 0; i < rows.length; i++) {
        if (i % 3 === 0) continue;
        const order = rows[i];
        const [existing] = await db.query('SELECT COUNT(*) AS total FROM COMPROBANTE_PAGO WHERE id_pedido = ?', [order.id_pedido]);
        if (Number(existing.total)) { count += Number(existing.total); continue; }
        let [actor] = await db.query("SELECT id_usuario FROM USUARIO WHERE id_cliente = ? AND rol = 'CLIENTE' LIMIT 1", [order.id_cliente]);
        if (!actor) {
          const result = await db.query("INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo) VALUES (?, ?, ?, 'CLIENTE', 1)",
            [order.id_cliente, `preview-348-${order.id_cliente}@example.test`, hash]);
          actor = { id_usuario: result.insertId };
        }
        const id = randomUUID();
        const pdf = await PDFDocument.create();
        pdf.addPage([420, 250]).drawText(`Comprobante de prueba\nPedido ${order.id_pedido}\nImporte: USD ${order.total}\nFixture temporal UI-PREVIEW-348`, { x: 30, y: 200, size: 12, lineHeight: 22 });
        const bytes = Buffer.from(await pdf.save());
        const file = path.join(root, id);
        assert.equal(path.dirname(file), root);
        fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
        written.push(file);
        await db.query(`
          INSERT INTO COMPROBANTE_PAGO (id_comprobante, id_cliente, id_usuario_carga, id_pedido,
            tipo_mime, bytes, sha256, fecha_utc, id_admin_revision, revision_utc)
          VALUES (?, ?, ?, ?, 'application/pdf', ?, ?, UTC_TIMESTAMP(3), ?, ?)
        `, [id, order.id_cliente, actor.id_usuario, order.id_pedido, bytes.length, createHash('sha256').update(bytes).digest(),
          i % 3 === 2 ? admin.id_usuario : null, i % 3 === 2 ? new Date() : null]);
        count++;
      }
      await db.commit();
      return count;
    } catch (error) {
      await db.rollback();
      for (const file of written) fs.unlinkSync(file);
      throw error;
    }
  } finally { await db.end(); }
}

module.exports = { seedAdminPreviewOrders, seedAdminPreviewReceipts, marker };
