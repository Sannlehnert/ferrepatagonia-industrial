import { Rule } from '../rules';

export class Login {
  @Rule(v => typeof v === 'string' && v.length > 0 && [...v].length <= 254
    ? null : 'Email y contraseña son obligatorios')
  email!: string;

  // No trim or normalization: spaces can be part of an existing password.
  @Rule(v => typeof v !== 'string' || !v.length ? 'Email y contraseña son obligatorios'
    : Buffer.byteLength(v, 'utf8') > 72 ? 'La contraseña supera el límite de bcrypt.' : null)
  password!: string;
}
