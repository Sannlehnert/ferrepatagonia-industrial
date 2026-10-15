import { pool } from '../config/database.config';

type ClienteListRow = {
  id_cliente: number;
  nombre_razon_social: string;
  email: string;
  fecha_creacion: Date;
};

export async function findAllClientes(): Promise<ClienteListRow[]> {
  return pool.query<ClienteListRow[]>(`
    SELECT c.id_cliente, c.nombre_razon_social, u.email, u.fecha_creacion
    FROM CLIENTE c
    INNER JOIN USUARIO u ON u.id_cliente = c.id_cliente
    WHERE u.rol = 'CLIENTE'
    ORDER BY u.fecha_creacion DESC, c.id_cliente DESC
  `);
}
