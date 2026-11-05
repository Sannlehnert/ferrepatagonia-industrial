import type { DataSource } from 'typeorm';
import { dataSource } from '../config/database.config';
import { ProductoSchema, UsuarioSchema } from '../entities/active.schemas';
import { PricingError } from '../services/pricing/money';
import type { CommercialSnapshot, PricingClient, PricingSource } from '../services/pricing/pricing.types';

export interface PricingPersistenceOptions {
  // Server-side deployment evidence that this dataset was reviewed as USD.
  // The migration preserves legacy values; its presence is not currency evidence.
  usdDatasetEvidence?: string;
}
type IdentityRow = {
  usuarioId: number; clienteId: number | null; usuarioActivo: number; rol: string;
  clienteActivo: number | null; assignedListId: number | null;
  listaId: number | null; listaActiva: number | null; porcentaje: string | null;
};

export class MariaDbPricingSource implements PricingSource {
  constructor(private readonly options: PricingPersistenceOptions = {}, private readonly db: DataSource = dataSource) {}

  async load(usuarioId: number | null, productoIds: readonly number[], _at: Date): Promise<CommercialSnapshot> {
    if (!this.options.usdDatasetEvidence?.trim()) throw new PricingError('UNIDAD_USD_NO_VERIFICADA', 503);
    if ((usuarioId !== null && (!Number.isInteger(usuarioId) || usuarioId < 1 || usuarioId > 2147483647))
      || productoIds.length < 1 || productoIds.length > 100
      || productoIds.some(id => !Number.isInteger(id) || id < 1 || id > 2147483647)) {
      throw new PricingError('SOLICITUD_INVALIDA', 400);
    }
    const runner = this.db.createQueryRunner();
    let connection: { destroy(): void } | undefined;
    try {
      connection = await runner.connect();
      // InnoDB establishes the consistent view on the first nonlocking SELECT.
      // Every commercial read uses this runner, never the global repository.
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
        if (!row || row.usuarioActivo !== 1 || row.rol !== 'CLIENTE' || row.clienteActivo !== 1 || row.clienteId === null) {
          throw new PricingError('NO_AUTORIZADO', 403);
        }
        client = { usuarioId: row.usuarioId, clienteId: row.clienteId, active: true,
          assignedListId: row.assignedListId,
          list: row.listaId === null ? null : { id: row.listaId, active: row.listaActiva === 1, percent: row.porcentaje! } };
      }
      const products = await runner.manager.getRepository(ProductoSchema).createQueryBuilder('p')
        .innerJoin('p.categoria', 'c').select('p.id_producto', 'id')
        .addSelect('p.precio', 'baseUSD').addSelect('p.descuento_especial_pct', 'specialPercent')
        .where('p.id_producto IN (:...ids)', { ids: [...productoIds] })
        .andWhere('p.activo = 1 AND c.activo = 1').orderBy('p.id_producto', 'ASC')
        .getRawMany<CommercialSnapshot['products'][number]>();
      // #240 has COTIZACION but no verified calendar nor quote-verification
      // evidence. Do not turn valida=1 into a fabricated VerifiedQuote.
      await runner.commitTransaction();
      return { client, products, calendar: null, quote: null };
    } catch (error) {
      if (runner.isTransactionActive) {
        try { await runner.rollbackTransaction(); } catch { connection?.destroy(); }
      } else connection?.destroy();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async recordInactiveList(_event: Parameters<PricingSource['recordInactiveList']>[0]): Promise<void> {
    // No approved audit table/sink in #240. Fail explicitly rather than claim
    // that an administrative event was persisted or use an unrelated table.
    throw new PricingError('AUDITORIA_LISTA_NO_DISPONIBLE', 503);
  }
}
