import Joi from 'joi';
import { isAbsolute } from 'node:path';

export type StorageEnvVar =
  | 'PRODUCT_IMAGE_STORAGE_DIR'
  | 'RECEIPT_STORAGE_DIR'
  | 'IMPORT_STORAGE_DIR';

export interface StorageConfig {
  productImages: string | undefined;
  receipts: string | undefined;
  imports: string | undefined;
}

const optionalStorageDirSchema = Joi.string()
  .allow('')
  .custom((value: string, helpers) => {
    if (value.includes('\0') || value.trim() !== value || !isAbsolute(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  })
  .optional();

export const storageEnvSchema = Joi.object({
  PRODUCT_IMAGE_STORAGE_DIR: optionalStorageDirSchema,
  RECEIPT_STORAGE_DIR: optionalStorageDirSchema,
  IMPORT_STORAGE_DIR: optionalStorageDirSchema,
}).unknown(true);

const singleStorageSchemas: Record<StorageEnvVar, Joi.ObjectSchema> = {
  PRODUCT_IMAGE_STORAGE_DIR: Joi.object({ PRODUCT_IMAGE_STORAGE_DIR: optionalStorageDirSchema }),
  RECEIPT_STORAGE_DIR: Joi.object({ RECEIPT_STORAGE_DIR: optionalStorageDirSchema }),
  IMPORT_STORAGE_DIR: Joi.object({ IMPORT_STORAGE_DIR: optionalStorageDirSchema }),
};

const normalizeOptionalDir = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Validates optional filesystem storage directories configured in environment variables.
 */
export function loadStorageConfig(raw: NodeJS.ProcessEnv): StorageConfig {
  const { error, value } = storageEnvSchema.validate(raw, { convert: false, abortEarly: true });
  if (error) {
    const key = String(error.details[0]?.path[0] ?? 'STORAGE_DIR');
    throw new Error(`Configuración inválida: ${key}.`);
  }
  const validated = value as Record<StorageEnvVar, unknown>;
  return {
    productImages: normalizeOptionalDir(validated.PRODUCT_IMAGE_STORAGE_DIR),
    receipts: normalizeOptionalDir(validated.RECEIPT_STORAGE_DIR),
    imports: normalizeOptionalDir(validated.IMPORT_STORAGE_DIR),
  };
}

/**
 * Dynamically validates and reads a single optional storage directory environment variable.
 */
export function readStorageDir(
  name: StorageEnvVar,
  raw: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const { error, value } = singleStorageSchemas[name].validate(
    { [name]: raw[name] },
    { convert: false, abortEarly: true },
  );
  if (error) {
    throw new Error(`Configuración inválida: ${name}.`);
  }
  return normalizeOptionalDir((value as Record<StorageEnvVar, unknown>)[name]);
}
