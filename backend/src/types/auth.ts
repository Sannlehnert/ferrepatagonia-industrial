export type Role = 'CLIENTE' | 'ADMIN';

export interface AuthContext {
  id: number;
  rol: Role;
}

export interface SessionUser extends AuthContext {
  email: string;
  tipo_cliente: 'PARTICULAR' | 'EMPRESA' | null;
  nombre: string;
}
