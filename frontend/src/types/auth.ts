export interface UsuarioSesion {
  id: number
  nombre: string
  email: string
  rol: string
  tipo_cliente: string | null
}