import { DataSource, Logger, QueryRunner } from 'typeorm';

// No query text, parameters, driver errors, entities or arbitrary messages enter logs.
export class SafeDatabaseLogger implements Logger {
  logQuery(): void {}
  logQueryError(): void { console.error('database.query.failed'); }
  logQuerySlow(milliseconds: number): void {
    console.warn('database.query.slow', { milliseconds: Number.isFinite(milliseconds) ? milliseconds : 0 });
  }
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

export class ControlledDataSource extends DataSource {
  override createQueryRunner(mode: 'master' | 'slave' = 'master'): QueryRunner {
    const runner = super.createQueryRunner(mode);
    const query = runner.query.bind(runner);
    runner.query = (sql: string, parameters?: unknown[], structured?: boolean) => {
      // Fixed MariaDB statement-scoped limits: no session leakage and no client
      // timer that abandons a still-running mutation. Transaction control is not wrapped.
      const bounded = /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)
        ? 'SET STATEMENT max_statement_time=5, innodb_lock_wait_timeout=5 FOR ' + sql : sql;
      return structured ? query(bounded, parameters, true) : query(bounded, parameters);
    };
    return runner;
  }
}

export class DatabaseOutcomeUnknownError extends Error {
  readonly code = 'DATABASE_OUTCOME_UNKNOWN';
  constructor() {
    super('No se pudo confirmar el resultado de la operación. Verificá el estado antes de reintentar.');
  }
}
export function mutationErrorMessage(error: unknown): string {
  return error instanceof DatabaseOutcomeUnknownError ? error.message : 'Error interno del servidor';
}

