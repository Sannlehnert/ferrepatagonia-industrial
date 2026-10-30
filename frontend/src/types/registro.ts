
import type { TipoCliente } from '@/types/auth'

export interface RegistroForm {
  tipoCliente: TipoCliente
  nombre: string
  apellido: string
  razonSocial: string
  cuit: string
  email: string
  telefono: string
  direccion: string
  password: string
  confirmar: string
}

export interface RegistroPayload {
  tipoCliente: TipoCliente
  nombreRazonSocial: string
  email: string
  password: string
  cuit?: string
  telefono?: string
  direccion?: string
}