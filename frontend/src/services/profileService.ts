import api from '@/services/api'

export interface AccountProfile {
  id: number
  tipoCliente: 'PARTICULAR' | 'EMPRESA'
  nombreRazonSocial: string
  email: string
  docCliente: string | null
  cuit: string | null
  telefono: string | null
  direccion: string | null
  estadoAprobacionEmpresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null
  cuentaCorrienteHabilitada: boolean | null
}

export interface AccountProfileChanges {
  telefono?: string | null
  direccion?: string | null
}

export async function getOwnProfile(signal: AbortSignal): Promise<AccountProfile> {
  const { data } = await api.get<{ data: { perfil: AccountProfile } }>('/perfil', { signal })
  return data.data.perfil
}

export async function updateOwnProfile(
  changes: AccountProfileChanges,
  signal: AbortSignal,
): Promise<AccountProfile> {
  const { data } = await api.patch<{ data: { perfil: AccountProfile } }>('/perfil', changes, { signal })
  return data.data.perfil
}
