import type { DataSource } from 'typeorm';
import { dataSource } from '../config/database.config';
import { ProductoSchema, UsuarioSchema } from '../entities/active.schemas';
import { PricingError } from '../services/pricing/money';
import { civilDate, resolveReference } from '../services/pricing/pricing.quote';
import type { CommercialSnapshot, PricingClient, PricingSource, VerifiedCalendar } from '../services/pricing/pricing.types';

type IdentityRow = {
  usuarioId: number; clienteId: number | null; usuarioActivo: number; rol: string;
  clienteActivo: number | null; assignedListId: number | null;
  listaId: number | null; listaActiva: number | null; porcentaje: string | null;
};
const sqlUTC = (at: Date) => at.toISOString().slice(0, 23).replace('T', ' ');
const utc = (column: string) => `DATE_FORMAT(${column}, '%Y-%m-%dT%H:%i:%s.%fZ')`;
function civilTimestamp(at: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(at));
  const v = Object.fromEntries(p.map(part => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}

export class MariaDbPricingSource implements PricingSource {
  constructor(private readonly db: DataSource = dataSource) {}

  async load(usuarioId: number | null, ids: readonly number[], at: Date, currency: 'USD' | 'ARS' = 'USD'): Promise<CommercialSnapshot> {
    return this.withSnapshot(usuarioId, ids, at, async snapshot => {
      const { recordInactiveList: _audit, ...readOnly } = snapshot;
      return readOnly;
    }, currency);
  }

  async withSnapshot<T>(usuarioId: number | null, ids: readonly number[], at: Date,
    work: (snapshot: CommercialSnapshot) => Promise<T>, currency: 'USD' | 'ARS' = 'USD'): Promise<T> {
    if ((usuarioId !== null && (!Number.isInteger(usuarioId) || usuarioId < 1 || usuarioId > 2147483647))
      || ids.length < 1 || ids.length > 100 || ids.some(id => !Number.isInteger(id) || id < 1 || id > 2147483647)) {
      throw new PricingError('SOLICITUD_INVALIDA', 400);
    }
    const runner = this.db.createQueryRunner();
    let connection: { destroy(): void } | undefined;
    try {
      connection = await runner.connect();
      await runner.startTransaction('REPEATABLE READ');
      let client: PricingClient | null = null;
      if (usuarioId !== null) {
        const row = await runner.manager.getRepository(UsuarioSchema).createQueryBuilder('u')
          .leftJoin('u.cliente', 'c').leftJoin('c.lista_precio', 'l')
          .select('u.id_usuario', 'usuarioId').addSelect('u.id_cliente', 'clienteId')
          .addSelect('u.activo', 'usuarioActivo').addSelect('u.rol', 'rol')
          .addSelect('c.activo', 'clienteActivo').addSelect('c.id_lista_precio', 'assignedListId')
          .addSelect('l.id_lista_precio', 'listaId').addSelect('l.activa', 'listaActiva')
          .addSelect('l.porcentaje_descuento', 'porcentaje')
          .where('u.id_usuario = :usuarioId', { usuarioId }).getRawOne<IdentityRow>();
        if (!row || row.usuarioActivo !== 1 || row.rol !== 'CLIENTE' || row.clienteActivo !== 1 || row.clienteId === null) throw new PricingError('NO_AUTORIZADO', 403);
        client = { usuarioId: row.usuarioId, clienteId: row.clienteId, active: true, assignedListId: row.assignedListId,
          list: row.listaId === null ? null : { id: row.listaId, active: row.listaActiva === 1, percent: row.porcentaje! } };
      }
      const rawProducts = await runner.manager.getRepository(ProductoSchema).createQueryBuilder('p')
        .innerJoin('p.categoria', 'c')
        .leftJoin('PRECIO_USD_EVIDENCIA', 'e', 'e.id_producto=p.id_producto AND e.valida=1 AND e.precio_verificado=p.precio AND e.verificado_utc<=:at', { at: sqlUTC(at) })
        .leftJoin('USUARIO', 'ea', "ea.id_usuario=e.id_admin AND ea.rol='ADMIN'")
        .select('p.id_producto', 'id').addSelect('p.precio', 'baseUSD').addSelect('p.descuento_especial_pct', 'specialPercent')
        .addSelect('ea.id_usuario', 'verifiedBy').addSelect('e.evidencia', 'evidence')
        .addSelect(utc('e.verificado_utc'), 'verifiedAt').addSelect('e.sintetica', 'synthetic')
        .where('p.id_producto IN (:...ids)', { ids: [...ids] }).andWhere('p.activo=1 AND c.activo=1').orderBy('p.id_producto', 'ASC')
        .getRawMany<{ id: number; baseUSD: string | null; specialPercent: string | null; verifiedBy: number | null;
          evidence: string | null; verifiedAt: string; synthetic: number }>();
      const products = rawProducts.map(p => ({ id: p.id, baseUSD: p.baseUSD, specialPercent: p.specialPercent,
        baseVerified: p.verifiedBy !== null,
        ...(p.verifiedBy !== null ? { evidence: { reference: p.evidence!, verifiedAt: p.verifiedAt, synthetic: p.synthetic === 1 } } : {}) }));
      let calendar: VerifiedCalendar | null = null;
      let quote: CommercialSnapshot['quote'] = null;
      if (currency === 'ARS') {
        const [c] = await runner.manager.query(`SELECT k.version,k.dias_json,k.evidencia,k.id_admin,${utc('k.verificado_utc')} AS verifiedAt,k.sintetica
          FROM FER17_CALENDARIO k JOIN USUARIO a ON a.id_usuario=k.id_admin AND a.rol='ADMIN'
          WHERE k.activo=1 AND k.verificado_utc<=? ORDER BY k.verificado_utc DESC,k.version DESC LIMIT 1`, [sqlUTC(at)]);
        if (c) {
          let days: unknown;
          try { days = JSON.parse(c.dias_json); } catch { throw new PricingError('CALENDARIO_NO_VERIFICADO'); }
          if (!days || typeof days !== 'object' || Array.isArray(days)) throw new PricingError('CALENDARIO_NO_VERIFICADO');
          calendar = { version: c.version, days: days as Record<string, boolean>, evidence: c.evidencia,
            verifiedBy: String(c.id_admin), verifiedAt: c.verifiedAt, synthetic: c.sintetica === 1 };
        }
        const reference = resolveReference(calendar, at);
        const [q] = await runner.manager.query(`SELECT q.id_cotizacion,q.tasa,q.valida,q.actor,
          DATE_FORMAT(q.fecha_referencia,'%Y-%m-%d') AS referenceDate,DATE_FORMAT(q.fecha_carga,'%Y-%m-%d %H:%i:%s') AS loadedCivil,
          ${utc('v.cargada_utc')} AS loadedAt,${utc('v.verificado_utc')} AS verifiedAt,v.evidencia,v.sintetica,
          (v.valida=1 AND v.tasa_verificada=q.tasa AND v.referencia_verificada=q.fecha_referencia
           AND BINARY v.actor_carga_verificado=BINARY q.actor AND v.banco='BNA' AND v.tipo='VENDEDOR' AND a.rol='ADMIN') AS verified
          FROM COTIZACION q LEFT JOIN FER17_COTIZACION_VERIFICACION v ON v.id_cotizacion=q.id_cotizacion
          LEFT JOIN USUARIO a ON a.id_usuario=v.id_admin WHERE q.fecha_referencia=?`, [reference]);
        if (q) {
          const valid = q.valida === 1 && q.verified === 1 && !!q.loadedAt && civilTimestamp(q.loadedAt) === q.loadedCivil;
          quote = { id: String(q.id_cotizacion), rate: q.tasa, referenceDate: q.referenceDate, loadedAt: q.loadedAt,
            actor: q.actor, valid, verifiedAt: q.verifiedAt, evidence: q.evidencia, synthetic: q.sintetica === 1 };
        }
      }
      const audit: PricingSource['recordInactiveList'] = async event => {
        if (!client || event.usuarioId !== usuarioId || event.clienteId !== client.clienteId
          || event.listaId !== client.assignedListId || client.list?.active !== false) throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
        await runner.manager.query(`INSERT INTO FER17_LISTA_INACTIVA_EVENTO
          (id_usuario,id_cliente,id_lista_precio,fecha_aplicable,detectado_utc) VALUES(?,?,?,?,?)
          ON DUPLICATE KEY UPDATE id_evento=id_evento`, [event.usuarioId,event.clienteId,event.listaId,civilDate(at),sqlUTC(at)]);
      };
      const result = await work({ client, products, calendar, quote, recordInactiveList: audit });
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner.isTransactionActive) { try { await runner.rollbackTransaction(); } catch { connection?.destroy(); } }
      else connection?.destroy();
      throw error;
    } finally { await runner.release(); }
  }

  async recordInactiveList(): Promise<void> { throw new PricingError('TRANSACCION_REQUERIDA', 500); }
}
