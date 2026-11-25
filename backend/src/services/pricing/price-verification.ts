import type { DataSource, EntityManager } from 'typeorm';
import { inTransactionOn } from '../../config/database.config';
import { dataSource } from '../../config/database.config';
import { MariaDbPricingSource } from '../../repositories/pricing.source';
import { PricingError } from './money';
import { PricingService } from './pricing.service';
import {
  normalizeExpectedPrice,
  normalizePriceAmount,
  parsePositiveId,
  PriceVerificationError,
  validateEvidenceReference,
} from './price-verification.rules';

export {
  normalizeExpectedPrice,
  parsePositiveId,
  PriceVerificationError,
  validateEvidenceReference,
} from './price-verification.rules';

/**
 * Authorized local procedure for commercial price verification (T-S7-05.2).
 *
 * This module is intentionally not mounted on an HTTP router. It reuses the
 * backend's transactional connection, but only an operational/local command may
 * invoke it with the database credential. The ADMIN identity is always re-read
 * and revalidated inside the transaction; an id supplied by a browser is never
 * sufficient.
 */

export interface VerifyPriceInput {
  productId: number;
  expectedPrice: string;
  evidence: string;
  adminId: number;
  confirmed: boolean;
}

export interface VerifyPriceSuccess {
  ok: true;
  productId: number;
  price: string;
  evidence: string;
  previousEvidence: string | null;
  adminId: number;
  adminEmail: string;
  verifiedAt: string;
  eventId: string;
  estadoFer17: string;
  publicado: boolean;
  replay: boolean;
}

export interface VerifyPriceRejected {
  ok: false;
  code: string;
  message: string;
  eventId: string | null;
}

export type VerifyPriceResult = VerifyPriceSuccess | VerifyPriceRejected;

export interface PriceEventRecord {
  idEvento: string;
  productId: number;
  tipo: string;
  precioAnterior: string | null;
  precioNuevo: string | null;
  evidencia: string | null;
  evidenciaAnterior: string | null;
  adminId: number | null;
  adminEmail: string | null;
  ocurridoUtc: string;
  resultado: string;
  motivo: string | null;
}

type ProductRow = { id_producto: number; precio: string | null; activo: number };
type AdminRow = { id_usuario: number; email: string; rol: string; activo: number };
type EvidenceRow = {
  precio_verificado: string;
  evidencia: string;
  id_admin: number;
  valida: number;
  sintetica: number;
  verificado_utc: string;
};

export interface VerifyPriceOptions {
  dataSource?: DataSource;
}

async function recordRejection(manager: EntityManager, input: {
  productId: number;
  currentPrice: string | null;
  expectedPrice: string;
  evidence: string;
  adminId: number;
  code: string;
}): Promise<string> {
  const result = await manager.query(
    `INSERT INTO FER17_PRECIO_EVENTO
      (id_producto,tipo,precio_anterior,precio_nuevo,evidencia,evidencia_anterior,id_admin,ocurrido_utc,resultado,motivo)
     VALUES (?, 'RECHAZO', ?, ?, ?, NULL, ?, UTC_TIMESTAMP(3), 'RECHAZADO', ?)`,
    [input.productId, input.currentPrice, input.expectedPrice, input.evidence, input.adminId, input.code],
  ) as { insertId: number | string };
  return String(result.insertId);
}

async function readFer17State(productId: number): Promise<string> {
  try {
    const result = await new PricingService(new MariaDbPricingSource()).resolve(
      { moneda: 'USD', productos: [{ productoId: productId, cantidad: 1 }] },
      'PUBLICO',
    );
    return result.productos[0]?.estadoPrecio ?? 'SIN_LINEA';
  } catch (error) {
    // The evidence is already committed. A post-commit diagnostic must not pretend
    // that a failed read rolled it back or expose internal details to the operator.
    if (error instanceof PricingError) return error.code;
    return 'ERROR_CONSULTA';
  }
}

export async function verifyProductPrice(
  input: VerifyPriceInput,
  options: VerifyPriceOptions = {},
): Promise<VerifyPriceResult> {
  const productId = parsePositiveId(input.productId, 'El producto');
  const adminId = parsePositiveId(input.adminId, 'El operador');
  const expectedPrice = normalizeExpectedPrice(input.expectedPrice);
  const evidence = validateEvidenceReference(input.evidence);
  if (input.confirmed !== true) {
    throw new PriceVerificationError('CONFIRMACION_REQUERIDA', 400,
      'La verificación exige confirmación explícita de revisión manual (--confirmar).');
  }

  const source = options.dataSource ?? dataSource;
  const verified = await inTransactionOn(source, async manager => {
    const readAdmin = async (lock: boolean): Promise<AdminRow> => {
      const [admin] = await manager.query<AdminRow[]>(
        `SELECT id_usuario,email,rol,activo FROM USUARIO WHERE id_usuario = ?${lock ? ' LOCK IN SHARE MODE' : ''}`,
        [adminId],
      );
      if (!admin || admin.rol !== 'ADMIN' || admin.activo !== 1) {
        throw new PriceVerificationError('ACTOR_NO_AUTORIZADO', 403,
          'El operador no existe, no está activo o no tiene rol ADMIN.');
      }
      return admin;
    };

    // Reject unauthorized actors before touching a product, without a row lock.
    await readAdmin(false);
    // Match checkout: product -> evidence -> evidence operator.
    const [product] = await manager.query<ProductRow[]>(
      `SELECT id_producto,precio,activo FROM PRODUCTO WHERE id_producto = ? FOR UPDATE`,
      [productId],
    );
    const [previous] = product ? await manager.query<EvidenceRow[]>(
      `SELECT precio_verificado,evidencia,id_admin,valida,sintetica,
        DATE_FORMAT(verificado_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS verificado_utc
       FROM PRECIO_USD_EVIDENCIA WHERE id_producto = ? FOR UPDATE`,
      [productId],
    ) : [];
    const admin = await readAdmin(true);
    if (!product) {
      throw new PriceVerificationError('PRODUCTO_INEXISTENTE', 404, 'El producto no existe.');
    }

    const currentPrice = product.precio === null ? null : normalizePriceAmount(product.precio);
    if (currentPrice === null) {
      const eventId = await recordRejection(manager, {
        productId, currentPrice: null, expectedPrice, evidence, adminId, code: 'PRECIO_AUSENTE',
      });
      return { ok: false as const, code: 'PRECIO_AUSENTE', message: 'El producto no tiene precio para verificar.', eventId };
    }
    if (currentPrice === '0.00') {
      const code = 'PRECIO_BASE_CERO';
      const eventId = await recordRejection(manager, { productId, currentPrice, expectedPrice, evidence, adminId, code });
      return { ok: false as const, code, message: 'El precio base es cero y no puede verificarse.', eventId };
    }
    if (currentPrice !== expectedPrice) {
      const eventId = await recordRejection(manager, {
        productId, currentPrice, expectedPrice, evidence, adminId, code: 'IMPORTE_NO_COINCIDE',
      });
      return {
        ok: false as const,
        code: 'IMPORTE_NO_COINCIDE',
        message: `El precio actual es ${currentPrice} USD y el importe revisado fue ${expectedPrice} USD.`,
        eventId,
      };
    }

    const alreadyVerified = previous?.valida === 1 && previous.sintetica === 0
      && previous.precio_verificado === currentPrice
      && previous.evidencia === evidence
      && Number(previous.id_admin) === adminId;
    if (alreadyVerified) {
      const [lastVerification] = await manager.query<Array<{ id_evento: number | string }>>(
        `SELECT id_evento FROM FER17_PRECIO_EVENTO
         WHERE id_producto = ? AND tipo = 'VERIFICACION'
           AND precio_nuevo = ? AND evidencia = ? AND id_admin = ?
         ORDER BY id_evento DESC LIMIT 1`,
        [productId, currentPrice, evidence, adminId],
      );
      return {
        ok: true as const,
        productId,
        price: currentPrice,
        evidence,
        previousEvidence: previous.evidencia,
        adminId,
        adminEmail: admin.email,
        verifiedAt: previous.verificado_utc,
        eventId: lastVerification ? String(lastVerification.id_evento) : '',
        replay: true,
      };
    }

    await manager.query(
      `INSERT INTO PRECIO_USD_EVIDENCIA
        (id_producto,precio_verificado,evidencia,id_admin,verificado_utc,valida,sintetica)
       VALUES (?,?,?,?,UTC_TIMESTAMP(3),1,0)
       ON DUPLICATE KEY UPDATE
        precio_verificado=VALUES(precio_verificado),evidencia=VALUES(evidencia),
        id_admin=VALUES(id_admin),verificado_utc=VALUES(verificado_utc),valida=1,sintetica=0`,
      [productId, currentPrice, evidence, adminId],
    );

    const [stored] = await manager.query<{ verifiedAt: string }[]>(
      `SELECT DATE_FORMAT(verificado_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS verifiedAt
       FROM PRECIO_USD_EVIDENCIA WHERE id_producto = ?`,
      [productId],
    );
    const event = await manager.query(
      `INSERT INTO FER17_PRECIO_EVENTO
        (id_producto,tipo,precio_anterior,precio_nuevo,evidencia,evidencia_anterior,id_admin,ocurrido_utc,resultado,motivo)
       VALUES (?, 'VERIFICACION', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), 'APLICADO', NULL)`,
      [productId, previous?.precio_verificado ?? null, currentPrice, evidence, previous?.evidencia ?? null, adminId],
    ) as { insertId: number | string };

    return {
      ok: true as const,
      productId,
      price: currentPrice,
      evidence,
      previousEvidence: previous?.evidencia ?? null,
      adminId,
      adminEmail: admin.email,
      verifiedAt: stored.verifiedAt,
      eventId: String(event.insertId),
      replay: false,
    };
  // PRODUCTO serializes first attestations of the same product. READ COMMITTED
  // avoids gap locks for missing evidence on unrelated products.
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 5 });

  if (!verified.ok) return verified;
  const estadoFer17 = await readFer17State(productId);
  return { ...verified, estadoFer17, publicado: estadoFer17 === 'DEFINIDO' };
}

export async function listPriceHistory(productId: number, limit = 50): Promise<PriceEventRecord[]> {
  const id = parsePositiveId(productId, 'El producto');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new PriceVerificationError('SOLICITUD_INVALIDA', 400, 'El límite debe ser un entero entre 1 y 200.');
  }
  const rows = await dataSource.query<Array<{
    id_evento: number | string; id_producto: number; tipo: string;
    precio_anterior: string | null; precio_nuevo: string | null;
    evidencia: string | null; evidencia_anterior: string | null;
    id_admin: number | null; admin_email: string | null;
    ocurrido_utc: string; resultado: string; motivo: string | null;
  }>>(
    `SELECT e.id_evento,e.id_producto,e.tipo,e.precio_anterior,e.precio_nuevo,
      e.evidencia,e.evidencia_anterior,e.id_admin,u.email AS admin_email,
      DATE_FORMAT(e.ocurrido_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS ocurrido_utc,
      e.resultado,e.motivo
     FROM FER17_PRECIO_EVENTO e
     LEFT JOIN USUARIO u ON u.id_usuario = e.id_admin
     WHERE e.id_producto = ?
     ORDER BY e.id_evento DESC
     LIMIT ?`,
    [id, limit],
  );
  return rows.map(row => ({
    idEvento: String(row.id_evento),
    productId: Number(row.id_producto),
    tipo: row.tipo,
    precioAnterior: row.precio_anterior === null ? null : normalizePriceAmount(String(row.precio_anterior)),
    precioNuevo: row.precio_nuevo === null ? null : normalizePriceAmount(String(row.precio_nuevo)),
    evidencia: row.evidencia,
    evidenciaAnterior: row.evidencia_anterior,
    adminId: row.id_admin === null ? null : Number(row.id_admin),
    adminEmail: row.admin_email,
    ocurridoUtc: String(row.ocurrido_utc),
    resultado: row.resultado,
    motivo: row.motivo,
  }));
}
