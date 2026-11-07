import type { AdminAccountQuery } from '../dtos/adminAccount.query';
import { AccountQueryError, accountSourceUnavailable } from './adminAccount.errors';
import { adminAccountClientExists } from '../repositories/adminAccount.repository';

export async function queryAdminAccounts(_userId: number, _query: AdminAccountQuery): Promise<never> {
  if (_query.scope !== 'listado' && !await adminAccountClientExists(_query.clienteId!)) {
    throw new AccountQueryError(404, 'CLIENTE_NO_ENCONTRADO', 'El cliente no existe.');
  }
  // #260 must first supply accredited USD data, coverage, REAL/DEMO provenance,
  // historical allocations and a revision updated atomically by every writer.
  // Its current calcularEstadoCuenta and #251's offset cursor cannot satisfy #250.
  // Do not infer financial facts from the legacy tables or return a successful empty page.
  throw accountSourceUnavailable();
}
