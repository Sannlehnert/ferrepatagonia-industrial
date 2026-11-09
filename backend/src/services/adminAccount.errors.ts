export class AccountQueryError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export const invalidAccountQuery = () => new AccountQueryError(400, 'CONSULTA_INVALIDA', 'Consulta inválida.');

export const staleAccountQuery = () => new AccountQueryError(409, 'CONSULTA_DESACTUALIZADA',
  'La consulta cambió o venció. Reiniciá desde la primera página.');

const unavailableCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR', 'ER_SERVER_SHUTDOWN', 'ER_STATEMENT_TIMEOUT', 'ER_QUERY_TIMEOUT', 'ER_LOCK_WAIT_TIMEOUT',
]);

export function isAccountSourceUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  type DriverFailure = { code?: string; errno?: number };
  const failure = error as DriverFailure & { driverError?: DriverFailure };
  const driver = failure.driverError ?? failure;
  // mysql2 does not name MariaDB's ER_STATEMENT_TIMEOUT in its error table.
  return driver.errno === 1969 || unavailableCodes.has(driver.code ?? '');
}

export const accountSourceUnavailable = () => new AccountQueryError(503,
  'CUENTA_CORRIENTE_NO_DISPONIBLE', 'La consulta de cuentas corrientes no está disponible. Intentá nuevamente más tarde.');
