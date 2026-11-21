import type { UpdatePerfil } from '../dtos/profile/profile.dto';
import {
  findPerfilByUsuarioId,
  updatePerfilByUsuarioId,
  type PerfilRow,
  type PerfilUpdateResult,
} from '../repositories/perfil.repository';

export interface Perfil {
  id: number;
  tipoCliente: 'PARTICULAR' | 'EMPRESA';
  nombreRazonSocial: string;
  email: string;
  docCliente: string | null;
  cuit: string | null;
  telefono: string | null;
  direccion: string | null;
  estadoAprobacionEmpresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null;
  cuentaCorrienteHabilitada: boolean | null;
}

export class PerfilNoEncontradoError extends Error {
  readonly code = 'PERFIL_NO_ENCONTRADO';

  constructor() {
    super('Perfil no encontrado.');
  }
}

export class PerfilAccesoError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
  }
}

function toPerfil(row: PerfilRow): Perfil {
  return {
    id: Number(row.id_usuario),
    tipoCliente: row.tipo_cliente,
    nombreRazonSocial: row.nombre_razon_social,
    email: row.email,
    docCliente: row.doc_cliente ?? null,
    cuit: row.cuit ?? null,
    telefono: row.telefono ?? null,
    direccion: row.direccion ?? null,
    estadoAprobacionEmpresa: row.tipo_cliente === 'EMPRESA'
      ? row.estado_aprobacion_empresa ?? null
      : null,
    cuentaCorrienteHabilitada: row.tipo_cliente === 'EMPRESA'
      && row.cuenta_corriente_habilitada != null
      ? row.cuenta_corriente_habilitada === 1
      : null,
  };
}

function rejected(result: Extract<PerfilUpdateResult, { ok: false }>): never {
  switch (result.reason) {
    case 'USUARIO_INACTIVO':
      throw new PerfilAccesoError(401, 'No autenticado.');
    case 'CLIENTE_INACTIVO':
      throw new PerfilAccesoError(403, 'La cuenta de cliente no está habilitada.');
    case 'NO_AUTORIZADO':
      throw new PerfilAccesoError(403, 'El rol autenticado no tiene permiso.');
    default:
      throw new PerfilNoEncontradoError();
  }
}

export async function getPerfil(usuarioId: number): Promise<Perfil> {
  const row = await findPerfilByUsuarioId(usuarioId);
  if (!row) throw new PerfilNoEncontradoError();
  return toPerfil(row);
}

export async function updatePerfil(usuarioId: number, input: UpdatePerfil): Promise<Perfil> {
  const changes = {
    ...(input.telefono !== undefined ? { telefono: input.telefono } : {}),
    ...(input.direccion !== undefined ? { direccion: input.direccion } : {}),
  };
  const result = await updatePerfilByUsuarioId(usuarioId, changes);
  if (!result.ok) rejected(result);
  return toPerfil(result.perfil);
}
