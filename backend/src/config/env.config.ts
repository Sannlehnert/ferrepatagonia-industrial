import 'dotenv/config';
import { loadHttpSecurity, validateJwtSecret } from './http-security.config';

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Falta ${name}. Revisá backend/.env usando .env.example.`);
  }
  return value;
}

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} debe ser un puerto entre 1 y 65535.`);
  }
  return value;
}

const httpSecurity = loadHttpSecurity(process.env);
const legacyOrderOffset = process.env.LEGACY_ORDER_UTC_OFFSET ?? '+00:00';
if (!/^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/.test(legacyOrderOffset)) {
  throw new Error('LEGACY_ORDER_UTC_OFFSET debe indicar el desplazamiento histórico respecto de UTC.');
}

export const env = {
  httpSecurity,
  legacyOrderOffset,
  jwtSecret: validateJwtSecret(required('JWT_SECRET'), httpSecurity.mode),
  port: port('PORT', 3000),
  db: {
    host: required('DB_HOST'),
    port: port('DB_PORT', 3307),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
  },
};
