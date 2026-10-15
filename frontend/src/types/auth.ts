export type Rol = 'CLIENTE' | 'ADMIN'
export type TipoCliente = 'PARTICULAR' | 'EMPRESA'

export interface UsuarioSesion {
  id: number
  nombre: string
  email: string
  rol: Rol
  tipo_cliente: TipoCliente | null // null para ADMIN
}