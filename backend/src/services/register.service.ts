import type { RegisterInput } from '../validators/register.validator';
import { hashPassword } from './password.service';
import { inTransaction } from '../config/database.config';
import { ClienteSchema, UsuarioSchema } from '../entities/active.schemas';

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
  const user = await prepareRegisterUser(input);
  return inTransaction(async manager => {
    const cliente = await manager.getRepository(ClienteSchema).insert({
      tipo_cliente: input.tipoCliente, nombre_razon_social: input.nombreRazonSocial,
      doc_cliente: input.docCliente, cuit: input.cuit, email: user.email,
      telefono: input.telefono, direccion: input.direccion,
      estado_aprobacion_empresa: input.tipoCliente === 'EMPRESA' ? 'PENDIENTE' : null,
      es_fiel: 0, activo: 1,
    });
    const usuario = await manager.getRepository(UsuarioSchema).insert({
      id_cliente: Number(cliente.identifiers[0].id_cliente), email: user.email,
      password_hash: user.passwordHash, rol: user.rol, activo: 1,
    });
    return { id: Number(usuario.identifiers[0].id_usuario), email: user.email,
      rol: user.rol, tipoCliente: input.tipoCliente };
  });
}
