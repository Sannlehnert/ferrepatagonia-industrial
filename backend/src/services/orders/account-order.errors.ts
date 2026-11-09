import type {
  AccountOrderHttpStatus,
} from './account-order.types';

export class AccountOrderError extends Error {
  constructor(
    readonly code: string,
    readonly status: AccountOrderHttpStatus,
    message: string,
  ) {
    super(message);
    this.name = 'AccountOrderError';
  }
}