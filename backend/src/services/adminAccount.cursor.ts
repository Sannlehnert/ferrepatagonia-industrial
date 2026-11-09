import type { AdminAccountQuery } from '../dtos/adminAccount.query';
import type { AdminCursorPayload, Contexto } from '../dtos/cuentaCorriente/cuentaCorriente.dto';
import { invalidAccountQuery, staleAccountQuery } from './adminAccount.errors';
import { CURSOR_TTL_MS, decodeSignedAccountCursor, signCursor } from './cuentaCorriente.service';

type CursorScope = AdminCursorPayload['scope'];
type Key = AdminCursorPayload['ultimaClave'];

export function accountFilters(query: AdminAccountQuery): AdminCursorPayload['filtros'] {
  const { clienteId, habilitada } = query;
  return {
    ...(clienteId === undefined ? {} : { clienteId }),
    ...(habilitada === undefined ? {} : { habilitada }),
  };
}

function iso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}

function int(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}

function validKey(key: Key | undefined, scope: CursorScope): boolean {
  if (!key || !int(key.id)) return false;
  if (scope === 'listado') return key.fecha === undefined;
  if (scope === 'movimientos') return iso(key.fecha);
  return typeof key.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key.fecha)
    && iso(`${key.fecha}T00:00:00.000Z`);
}

export function readAdminCursor(userId: number, query: AdminAccountQuery): AdminCursorPayload | undefined {
  if (query.cursor === undefined) return undefined;
  let cursor: Partial<AdminCursorPayload>;
  try {
    cursor = decodeSignedAccountCursor(query.cursor) as Partial<AdminCursorPayload>;
  } catch {
    throw invalidAccountQuery();
  }
  if (query.scope === 'resumen' || cursor.version !== 1 || cursor.rol !== 'ADMIN' ||
      cursor.userId !== userId || cursor.scope !== query.scope ||
      JSON.stringify(cursor.filtros) !== JSON.stringify(accountFilters(query)) ||
      (cursor.scope === 'listado' ? cursor.cuentaId !== null : !int(cursor.cuentaId)) ||
      !iso(cursor.corte) || typeof cursor.revision !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.revision) ||
      typeof cursor.exp !== 'number' || cursor.exp !== Date.parse(cursor.corte) + CURSOR_TTL_MS ||
      !validKey(cursor.ultimaClave, cursor.scope)) {
    throw invalidAccountQuery();
  }
  if (Date.now() >= cursor.exp) throw staleAccountQuery();
  return cursor as AdminCursorPayload;
}

export function signAdminCursor(
  userId: number,
  query: AdminAccountQuery & { scope: CursorScope },
  context: Contexto,
  cuentaId: number | null,
  ultimaClave: Key,
): string {
  return signCursor({
    version: 1,
    userId,
    rol: 'ADMIN',
    scope: query.scope,
    filtros: accountFilters(query),
    cuentaId,
    ...context,
    exp: Date.parse(context.corte) + CURSOR_TTL_MS,
    ultimaClave,
  });
}
