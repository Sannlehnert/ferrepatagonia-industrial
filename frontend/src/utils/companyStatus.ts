import type { UsuarioSesion } from '@/types/auth'
import type { CuentaCorrienteConsulta } from '@/types/cuentaCorriente'

export function approvalMessage(status: UsuarioSesion['estadoAprobacionEmpresa'] | undefined): string {
  if (status === 'PENDIENTE') return 'La aprobación de tu empresa está pendiente.'
  if (status === 'APROBADA') return 'Tu empresa está aprobada. La autorización de crédito se evalúa por separado.'
  if (status === 'RECHAZADA') return 'La solicitud de tu empresa fue rechazada. Contactá al equipo comercial.'
  return 'No se pudo determinar el estado de aprobación de tu empresa.'
}

export function creditMessage(account: CuentaCorrienteConsulta): string {
  if (account.estado === 'SIN_CUENTA') return 'No tenés una cuenta corriente asociada.'
  if (account.estado === 'INHABILITADA') return 'La cuenta corriente está inhabilitada; no podés operar a crédito.'
  if (account.estadoCredito === 'BLOQUEADO') return 'La cuenta corriente está habilitada, pero el crédito está bloqueado.'
  if (account.estadoCredito === 'DISPONIBLE') return 'La cuenta corriente está habilitada y el crédito está disponible. Cada compra está sujeta a validación.'
  return 'La cuenta corriente está habilitada, pero el estado del crédito no es determinable.'
}
