import { DefaultNamingStrategy, Table } from 'typeorm';
// TypeORM creates the owning OneToOne UNIQUE metadata itself. Reuse the real
// index name instead of inventing a second REL_* constraint.
export class SchemaNamingStrategy extends DefaultNamingStrategy {
  relationConstraintName(table: Table | string, columns: string[], where?: string): string {
    const name = typeof table === 'string' ? table : table.name;
    if (name === 'USUARIO' && columns.length === 1 && columns[0] === 'id_cliente') return 'uq_usuario_cliente';
    return super.relationConstraintName(table, columns, where);
  }
}
