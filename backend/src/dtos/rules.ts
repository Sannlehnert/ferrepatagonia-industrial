import { registerDecorator } from 'class-validator';

// A single rule can preserve the existing field-specific error without echoing input.
export function Rule(check: (value: unknown) => string | null): PropertyDecorator {
  return (target, property) => registerDecorator({
    name: 'contractRule', target: target.constructor, propertyName: String(property),
    validator: {
      validate: value => check(value) === null,
      defaultMessage: args => check(args?.value) ?? 'Solicitud inválida.',
    },
  });
}

export const integer = (v: unknown, min: number, max = 2147483647): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

// Invalid representations are retained for validation, never coerced to a valid number.
export function parseInteger(v: unknown, max: number): unknown {
  if (typeof v !== 'string' || !/^[1-9][0-9]*$/.test(v)) return null;
  const n = Number(v);
  return integer(n, 1, max) ? n : null;
}

export const roundSqlDecimal2 = (value: number): number =>
  ((value < 0 ? -1 : 1) * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
