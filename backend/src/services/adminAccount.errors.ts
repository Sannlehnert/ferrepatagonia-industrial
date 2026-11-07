export class AccountQueryError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export const invalidAccountQuery = () => new AccountQueryError(400, 'CONSULTA_INVALIDA', 'Consulta inválida.');

export const accountSourceUnavailable = () => new AccountQueryError(503,
  'CUENTA_CORRIENTE_NO_DISPONIBLE', 'La consulta de cuentas corrientes no está disponible. Intentá nuevamente más tarde.');
