import {
    ValidatorConstraint,
    ValidatorConstraintInterface
} from 'class-validator';
import { env } from '../../config/env.config';
import { usesProductImageNamespace } from '../../utils/product-image';

@ValidatorConstraint({ name: 'maxUtf8Bytes', async: false })
export class MaxUtf8BytesConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        if (value === undefined || value === null) {
            return true;
        }
        if (typeof value !== 'string') {
            return false;
        }
        return Buffer.byteLength(value, 'utf8') <= 65535;
    }

    defaultMessage(): string {
        return 'La descripción supera la longitud máxima permitida (65535 bytes).';
    }
}

@ValidatorConstraint({ name: 'strictDecimalScale', async: false })
export class StrictDecimalScaleConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                return false;
            }
            return /^-?\d+(\.\d{1,2})?$/.test(value.toString());
        }
        if (typeof value === 'string') {
            return /^-?\d+(\.\d{1,2})?$/.test(value.trim());
        }
        return false;
    }

    defaultMessage(): string {
        return 'El valor numérico debe tener como máximo 2 decimales.';
    }
}

@ValidatorConstraint({ name: 'validHttpUrl', async: false })
export class ValidHttpUrlConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        if (typeof value !== 'string') {
            return false;
        }
        try {
            const parsed = new URL(value);
            return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
                !usesProductImageNamespace(value, env.httpSecurity.publicOrigin);
        } catch {
            return false;
        }
    }

    defaultMessage(): string {
        return 'La URL de la imagen debe ser una dirección HTTP o HTTPS válida.';
    }
}
