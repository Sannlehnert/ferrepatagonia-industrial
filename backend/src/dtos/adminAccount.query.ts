import { invalidAccountQuery } from '../services/adminAccount.errors';

export type AccountScope = 'listado' | 'resumen' | 'movimientos' | 'vencimientos';
export interface AdminAccountQuery {
  scope: AccountScope;
  limite: number;
  clienteId?: number;
  habilitada?: boolean;
  cursor?: string;
}

export function positiveInt(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) throw invalidAccountQuery();
  return Number(value);
}

// Read the raw query: Express may otherwise collapse duplicates or parse nested keys.
export function parseAdminAccountQuery(url: string, scope: AccountScope, clienteId?: string): AdminAccountQuery {
  const separator = url.indexOf('?');
  const params = new URLSearchParams(separator < 0 ? '' : url.slice(separator + 1));
  const allowed = scope === 'listado' ? ['limite', 'cursor', 'clienteId', 'habilitada']
    : scope === 'resumen' ? [] : ['limite', 'cursor'];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw invalidAccountQuery();
  }
  const query: AdminAccountQuery = { scope, limite: 25 };
  if (clienteId !== undefined) query.clienteId = positiveInt(clienteId);
  if (params.has('clienteId')) query.clienteId = positiveInt(params.get('clienteId')!);
  if (params.has('limite')) {
    const value = params.get('limite')!;
    if (!/^(?:[1-9]|[1-9]\d|100)$/.test(value)) throw invalidAccountQuery();
    query.limite = Number(value);
  }
  if (params.has('habilitada')) {
    const value = params.get('habilitada');
    if (value !== 'true' && value !== 'false') throw invalidAccountQuery();
    query.habilitada = value === 'true';
  }
  if (params.has('cursor')) {
    const value = params.get('cursor')!;
    if (value.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw invalidAccountQuery();
    query.cursor = value;
  }
  return query;
}
