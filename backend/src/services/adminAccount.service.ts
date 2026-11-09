import type { EntityManager } from 'typeorm';
import { inTransaction } from '../config/database.config';
import type { AdminAccountQuery } from '../dtos/adminAccount.query';
import type { AdminCursorPayload, Consulta, Contexto, Detalle, ListadoAdmin, Movimiento, Pagina, Vencimiento } from '../dtos/cuentaCorriente/cuentaCorriente.dto';
import { adminAccountClientExists, findAccountReader, listAccountKeys } from '../repositories/adminAccount.repository';
import { calcularEstadoCuenta, findCuentaByClienteId, revisionConjunto } from '../repositories/cuentaCorriente.repository';
import { accountFilters, readAdminCursor, signAdminCursor } from './adminAccount.cursor';
import { AccountQueryError, invalidAccountQuery, staleAccountQuery } from './adminAccount.errors';
import { readAccountDueDates, readAccountMovements, readAccountSummary } from './cuentaCorriente.read';

type Key = AdminCursorPayload['ultimaClave'];
type Result = ListadoAdmin | Consulta | Detalle<Movimiento> | Detalle<Vencimiento>;

function page<T>(
  rows: T[],
  limite: number,
  context: Contexto,
  nextCursor: (last: T) => string,
): Pagina<T> {
  const items = rows.slice(0, limite);
  return {
    ...context,
    items,
    siguienteCursor: rows.length > limite ? nextCursor(items[items.length - 1]) : null,
  };
}

function movementKey(movement: Movimiento): Key {
  return { fecha: new Date(movement.fechaOperacion).toISOString(), id: Number(movement.id) };
}

function dueKey(due: Vencimiento): Key {
  return { fecha: due.venceEl, id: Number(due.movimientoId) };
}

function after(key: Key, last: Key, descending: boolean): boolean {
  const order = key.fecha === last.fecha ? key.id - last.id : key.fecha! < last.fecha! ? -1 : 1;
  return descending ? order < 0 : order > 0;
}

async function listAccounts(
  manager: EntityManager,
  userId: number,
  query: AdminAccountQuery,
  cursor: AdminCursorPayload | undefined,
  corte: string,
  excludeDemo: boolean,
): Promise<ListadoAdmin> {
  const filters = { ...accountFilters(query), excludeDemo };
  const revision = await revisionConjunto(manager, filters);
  if (cursor && cursor.revision !== revision) throw staleAccountQuery();

  const keys = await listAccountKeys(manager, filters, cursor?.ultimaClave.id ?? 0, query.limite + 1);
  const items = [];
  for (const key of keys.slice(0, query.limite)) {
    const state = await calcularEstadoCuenta(key.id_cuenta_corriente, manager);
    if (!state) throw new Error('Cuenta ausente en el snapshot.');
    const summary = await readAccountSummary(manager, state, corte);
    items.push({ clienteId: key.id_cliente, ...summary });
  }

  const context = { corte, revision };
  const last = items.at(-1);
  const siguienteCursor = last && keys.length > query.limite
    ? signAdminCursor(userId, { ...query, scope: 'listado' }, context, null, { id: last.clienteId })
    : null;
  return { ...context, items, siguienteCursor };
}

export async function queryAdminAccounts(userId: number, query: AdminAccountQuery): Promise<Result> {
  return inTransaction(async manager => {
    // Passport checks the session before the controller. Revalidate it in the same snapshot as the ledger.
    const reader = await findAccountReader(manager, userId);
    if (!reader?.activo) throw new AccountQueryError(401, 'NO_AUTENTICADO', 'No autenticado.');
    if (reader.rol !== 'ADMIN') throw new AccountQueryError(403, 'SIN_PERMISO', 'No tenés permiso para acceder a este recurso.');

    const cursor = readAdminCursor(userId, query);
    const corte = cursor?.corte ?? new Date().toISOString();
    const excludeDemo = process.env.NODE_ENV !== 'test';
    if (query.scope === 'listado') return listAccounts(manager, userId, query, cursor, corte, excludeDemo);

    const { clienteId, scope } = query;
    if (clienteId === undefined) throw invalidAccountQuery();
    if (!await adminAccountClientExists(manager, clienteId)) {
      throw new AccountQueryError(404, 'CLIENTE_NO_ENCONTRADO', 'El cliente no existe.');
    }
    const account = await findCuentaByClienteId(clienteId, manager);
    if (!account || (excludeDemo && account.origen_datos === 'DEMO')) {
      if (cursor) throw staleAccountQuery();
      return { corte, revision: 'rev-0', estado: 'SIN_CUENTA' };
    }

    const state = await calcularEstadoCuenta(account.id_cuenta_corriente, manager);
    if (!state) throw new Error('Cuenta ausente en el snapshot.');
    if (cursor && (cursor.cuentaId !== account.id_cuenta_corriente || cursor.revision !== state.revision)) {
      throw staleAccountQuery();
    }
    const context = { corte, revision: state.revision };
    if (scope === 'resumen') {
      return { ...context, ...await readAccountSummary(manager, state, corte) };
    }
    const detalle = {
      estado: state.habilitada ? 'HABILITADA' as const : 'INHABILITADA' as const,
      cobertura: state.cobertura,
    };
    const next = (key: Key) => signAdminCursor(userId, { ...query, scope }, context, account.id_cuenta_corriente, key);
    const last = cursor?.ultimaClave;
    if (scope === 'movimientos') {
      const movements = await readAccountMovements(manager, state, true);
      const rows = last ? movements.filter(m => after(movementKey(m), last, true)) : movements;
      return { ...detalle, ...page(rows, query.limite, context, m => next(movementKey(m))) };
    }
    const dues = await readAccountDueDates(manager, state, corte);
    const rows = last ? dues.filter(d => after(dueKey(d), last, false)) : dues;
    return { ...detalle, ...page(rows, query.limite, context, d => next(dueKey(d))) };
  }, { isolation: 'REPEATABLE READ' });
}
