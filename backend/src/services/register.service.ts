import type { RegisterInput } from '../validators/register.validator';
import { hashPassword } from './password.service';
import { pool } from '../config/database';

// Datos de USUARIO para el registro público; tipoCliente pertenece a CLIENTE.
export async function prepareRegisterUser(input: Pick<RegisterInput, 'email' | 'password'>) {
  return {
    email: input.email,
    passwordHash: await hashPassword(input.password),
    // El rol técnico se asigna exclusivamente en el servidor.
    rol: 'CLIENTE' as const,
  };
}

export async function registerClient(input: RegisterInput) {
  // Calcular bcrypt antes de ocupar una conexión y abrir la transacción.
  const user = await prepareRegisterUser(input);
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.beginTransaction();
    const cliente = await connection.query(
      `INSERT INTO CLIENTE
        (tipo_cliente, nombre_razon_social, doc_cliente, cuit, email, telefono,
         direccion, estado_aprobacion_empresa, es_fiel, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      [input.tipoCliente, input.nombreRazonSocial, input.docCliente, input.cuit,
        user.email, input.telefono, input.direccion,
        input.tipoCliente === 'EMPRESA' ? 'PENDIENTE' : null],
    );
    const usuario = await connection.query(
      `INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
       VALUES (?, ?, ?, ?, 1)`,
      [cliente.insertId, user.email, user.passwordHash, user.rol],
    );
    await connection.commit();
    return {
      // Los IDs son INT en el esquema; el driver devuelve insertId como bigint.
      id: Number(usuario.insertId),
      email: user.email,
      rol: user.rol,
      tipoCliente: input.tipoCliente,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // No devolver al pool una conexión cuyo estado transaccional es incierto.
      reusable = false;
      connection.destroy();
      throw error;
    }
    throw error;
  } finally {
    if (reusable) await connection.release();
  }
}
