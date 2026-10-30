import 'reflect-metadata';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate, validateSync, ValidatorOptions, ValidationError } from 'class-validator';

export interface DtoPolicy<T extends object> {
  type: ClassConstructor<T>;
  fields: readonly string[];
  objectError: string;
  unknownError: string;
  error?: string;
  prepare?: (input: Record<string, unknown>) => Record<string, unknown>;
  check?: (input: Record<string, unknown>) => string | null;
}

const options: ValidatorOptions = {
  whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
  skipMissingProperties: false, skipUndefinedProperties: false, skipNullProperties: false,
  validationError: { target: false, value: false },
};

function instantiate<T extends object>(policy: DtoPolicy<T>, input: unknown): T | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null, policy.type.prototype].includes(Object.getPrototypeOf(input))) return policy.objectError;
  const record = input as Record<string, unknown>;
  // Check BEFORE class-transformer, which intentionally skips __proto__/constructor.
  // Do not silently hide forbidden keys, invoke accessors, or copy inherited input.
  if (Reflect.ownKeys(record).some(key => typeof key !== 'string' || !policy.fields.includes(key)
    || !('value' in Object.getOwnPropertyDescriptor(record, key)!))) return policy.unknownError;
  // All seven DTOs are flat scalars. Reject structured values before transformation
  // can recurse into attacker-controlled objects or invoke a function supplied internally.
  if (Object.values(record).some(value => value !== null && value !== undefined
    && !['string', 'number', 'boolean'].includes(typeof value))) return policy.error ?? 'Solicitud inválida.';
  const error = policy.check?.(record);
  if (error) return error;
  return plainToInstance(policy.type, policy.prepare ? policy.prepare(record) : record, {
    enableImplicitConversion: false, exposeDefaultValues: false,
  });
}

function result<T extends object>(policy: DtoPolicy<T>, dto: T, errors: ValidationError[]) {
  // Only authored, fixed messages. Never expose the validation object or input values.
  return errors.length ? { valid: false as const, message: policy.error
    ?? Object.values(errors[0].constraints ?? {})[0] ?? 'Solicitud inválida.' }
    : { valid: true as const, data: dto };
}

export async function validateDtoInput<T extends object>(policy: DtoPolicy<T>, input: unknown) {
  const dto = instantiate(policy, input);
  if (typeof dto === 'string') return { valid: false as const, message: dto };
  return result(policy, dto, await validate(dto, options));
}

// Compatibility for existing synchronous validator consumers; same DTO/rules as HTTP.
export function validateDtoSync<T extends object>(policy: DtoPolicy<T>, input: unknown) {
  const dto = instantiate(policy, input);
  if (typeof dto === 'string') return { valid: false as const, message: dto };
  return result(policy, dto, validateSync(dto, options));
}
