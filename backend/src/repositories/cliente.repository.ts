import { pool } from '../config/database.config';

type ClienteListRow = {
  id_cliente: number;
  nombre_razon_social: string;
};

export async function findAllClientes(): Promise<ClienteListRow[]> {
  return pool.query<ClienteListRow[]>(`
    SELECT id_cliente, nombre_razon_social
    FROM CLIENTE
    ORDER BY fecha_alta DESC, id_cliente DESC
  `);
}
