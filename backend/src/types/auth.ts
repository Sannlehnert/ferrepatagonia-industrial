export type Role = 'CLIENTE' | 'ADMIN';

export interface AuthContext {
  id: number;
  rol: Role;
}
