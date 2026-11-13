import 'dotenv/config';
import Joi from 'joi';
import {
  loadHttpSecurity,
  type HttpSecurityConfig,
  type NodeMode,
  validateJwtSecret,
} from './http-security.config';
import { loadStorageConfig, type StorageConfig } from './storage-env.config';

export type { StorageConfig, StorageEnvVar } from './storage-env.config';
export { loadStorageConfig, readStorageDir } from './storage-env.config';

export interface BackendEnv {
  httpSecurity: HttpSecurityConfig;
  legacyOrderOffset: string;
  jwtSecret: string;
  port: number;
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  storage: StorageConfig;
}

const POSITIVE_INT_PATTERN = /^[1-9][0-9]*$/;
const LEGACY_OFFSET_PATTERN = /^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/;

const requiredEnvText = (): Joi.StringSchema =>
  Joi.string()
    .required()
    .custom((value: string, helpers) =>
      value.trim().length > 0 ? value : helpers.error('any.required'),
    );

const portField = (fallback: number): Joi.Schema =>
  Joi.string()
    .pattern(POSITIVE_INT_PATTERN)
    .custom((value: string, helpers) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65535
        ? parsed
        : helpers.error('any.invalid');
    })
    .default(fallback);

function buildCoreEnvSchema(mode: NodeMode): Joi.ObjectSchema {
  return Joi.object({
    LEGACY_ORDER_UTC_OFFSET: Joi.string().pattern(LEGACY_OFFSET_PATTERN).default('+00:00'),
    JWT_SECRET: requiredEnvText().custom((value: string, helpers) => {
      try {
        return validateJwtSecret(value, mode);
      } catch {
        return helpers.error('jwt.invalid');
      }
    }),
    PORT: portField(3000),
    DB_HOST: requiredEnvText(),
    DB_PORT: portField(3307),
    DB_NAME: requiredEnvText(),
    DB_USER: requiredEnvText(),
    DB_PASSWORD: requiredEnvText(),
  }).unknown(true);
}

function mapCoreEnvError(error: Joi.ValidationError): Error {
  const detail = error.details[0];
  const key = String(detail?.path[0] ?? 'ENV');
  if (key === 'LEGACY_ORDER_UTC_OFFSET') {
    return new Error('LEGACY_ORDER_UTC_OFFSET debe indicar el desplazamiento histórico respecto de UTC.');
  }
  if (key === 'PORT' || key === 'DB_PORT') {
    return new Error(`${key} debe ser un puerto entre 1 y 65535.`);
  }
  if (detail?.type === 'jwt.invalid') {
    return new Error('Configuración inválida: JWT_SECRET.');
  }
  return new Error(`Falta ${key}. Revisá backend/.env usando .env.example.`);
}

/**
 * Validates backend environment variables with Joi before database or HTTP server initialization.
 */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): BackendEnv {
  const httpSecurity = loadHttpSecurity(raw);
  const { error, value } = buildCoreEnvSchema(httpSecurity.mode).validate(raw, {
    convert: false,
    abortEarly: true,
  });
  if (error) {
    throw mapCoreEnvError(error);
  }
  const parsed = value as {
    LEGACY_ORDER_UTC_OFFSET: string;
    JWT_SECRET: string;
    PORT: number;
    DB_HOST: string;
    DB_PORT: number;
    DB_NAME: string;
    DB_USER: string;
    DB_PASSWORD: string;
  };
  const storage = loadStorageConfig(raw);
  return {
    httpSecurity,
    legacyOrderOffset: parsed.LEGACY_ORDER_UTC_OFFSET,
    jwtSecret: parsed.JWT_SECRET,
    port: parsed.PORT,
    db: {
      host: parsed.DB_HOST,
      port: parsed.DB_PORT,
      database: parsed.DB_NAME,
      user: parsed.DB_USER,
      password: parsed.DB_PASSWORD,
    },
    storage,
  };
}

export const env: BackendEnv = loadEnv(process.env);
