import { IsBoolean,IsDefined,IsInt,IsNotEmpty,IsNumber,IsOptional,IsString,Max,MaxLength,Min,Validate,ValidatorConstraint,ValidatorConstraintInterface,validate } from 'class-validator';

@ValidatorConstraint({ name: 'maxUtf8Bytes', async: false })
class MaxUtf8BytesConstraint implements ValidatorConstraintInterface {
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

export class ProductImportRowDto {
    @IsDefined({ message: 'El código SKU es obligatorio.' })
    @IsString({ message: 'El código SKU debe ser texto.' })
    @IsNotEmpty({ message: 'El código SKU no puede estar vacío.' })
    @MaxLength(100, { message: 'El código SKU no debe superar los 100 caracteres.' })
    codigo!: string;

    @IsDefined({ message: 'El nombre del producto es obligatorio.' })
    @IsString({ message: 'El nombre del producto debe ser texto.' })
    @IsNotEmpty({ message: 'El nombre del producto no puede estar vacío.' })
    @MaxLength(200, { message: 'El nombre del producto no debe superar los 200 caracteres.' })
    nombre!: string;

    @IsDefined({ message: 'La categoría es obligatoria.' })
    @IsInt({ message: 'La categoría debe ser un número entero válido.' })
    @Min(1, { message: 'La categoría debe ser un número entero mayor a 0.' })
    @Max(2147483647, { message: 'La categoría supera el límite permitido.' })
    id_categoria!: number;

    @IsDefined({ message: 'El precio es obligatorio.' })
    @IsNumber(
        { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
        { message: 'El precio debe ser un número válido con hasta 2 decimales.' }
    )
    @Min(0, { message: 'El precio debe ser mayor o igual a 0.' })
    @Max(9999999999.99, { message: 'El precio no debe superar 9999999999.99.' })
    precio!: number;

    @IsDefined({ message: 'El stock es obligatorio.' })
    @IsInt({ message: 'El stock debe ser un número entero sin decimales.' })
    @Min(0, { message: 'El stock debe ser mayor o igual a 0.' })
    @Max(2147483647, { message: 'El stock no debe superar 2147483647.' })
    stock!: number;

    @IsOptional()
    @IsString({ message: 'La descripción debe ser texto.' })
    @Validate(MaxUtf8BytesConstraint)
    descripcion?: string | null;

    @IsOptional()
    @IsString({ message: 'La URL de la imagen debe ser texto.' })
    @MaxLength(2048, { message: 'La URL de la imagen no debe superar los 2048 caracteres.' })
    imagen?: string | null;

    @IsOptional()
    @IsBoolean({ message: 'El campo activo debe ser booleano (true/false, 1/0, si/no).' })
    activo?: boolean;
}

export interface RawImportRow {
    codigo?: unknown;
    nombre?: unknown;
    id_categoria?: unknown;
    precio?: unknown;
    stock?: unknown;
    descripcion?: unknown;
    imagen?: unknown;
    activo?: unknown;
}

export interface RowFieldError {
    row: number;
    field: string;
    message: string;
}

const parseStrictInteger = (raw: unknown): unknown => {
    if (raw === undefined || raw === null || raw === '') {
        return undefined;
    }
    if (typeof raw === 'number') {
        return Number.isInteger(raw) ? raw : raw;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '') {
            return undefined;
        }
        if (!/^-?\d+$/.test(trimmed)) {
            return Number.NaN;
        }
        return Number(trimmed);
    }
    return raw;
};

const parseStrictDecimal = (raw: unknown): unknown => {
    if (raw === undefined || raw === null || raw === '') {
        return undefined;
    }
    if (typeof raw === 'number') {
        return raw;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim().replace(',', '.');
        if (trimmed === '') {
            return undefined;
        }
        if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return Number.NaN;
        }
        return Number(trimmed);
    }
    return raw;
};

const parseStrictBoolean = (raw: unknown): unknown => {
    if (raw === undefined || raw === null || raw === '') {
        return undefined;
    }
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (typeof raw === 'number') {
        if (raw === 1) return true;
        if (raw === 0) return false;
        return raw;
    }
    if (typeof raw === 'string') {
        const normalized = raw.trim().toLowerCase();
        if (normalized === '') return undefined;
        if (['true', '1', 'si', 'sí', 'activo'].includes(normalized)) return true;
        if (['false', '0', 'no', 'inactivo'].includes(normalized)) return false;
        return raw;
    }
    return raw;
};

export const buildProductImportDto = (raw: RawImportRow): ProductImportRowDto => {
    const dto = new ProductImportRowDto();

    dto.codigo =
        raw.codigo === undefined || raw.codigo === null || String(raw.codigo).trim() === ''
            ? (undefined as unknown as string)
            : String(raw.codigo).trim();

    dto.nombre =
        raw.nombre === undefined || raw.nombre === null || String(raw.nombre).trim() === ''
            ? (undefined as unknown as string)
            : String(raw.nombre).trim();

    dto.id_categoria = parseStrictInteger(raw.id_categoria) as number;
    dto.precio = parseStrictDecimal(raw.precio) as number;
    dto.stock = parseStrictInteger(raw.stock) as number;

    if (raw.descripcion === undefined || raw.descripcion === null || String(raw.descripcion).trim() === '') {
        dto.descripcion = undefined;
    } else {
        dto.descripcion = String(raw.descripcion).trim();
    }

    if (raw.imagen === undefined || raw.imagen === null || String(raw.imagen).trim() === '') {
        dto.imagen = undefined;
    } else {
        dto.imagen = String(raw.imagen).trim();
    }

    const parsedActivo = parseStrictBoolean(raw.activo);
    dto.activo = parsedActivo === undefined ? true : (parsedActivo as boolean);

    return dto;
};

export const validateProductImportDto = async (
    dto: ProductImportRowDto,
    rowNumber: number
): Promise<RowFieldError[]> => {
    const validationErrors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true
    });

    const formattedErrors: RowFieldError[] = [];

    for (const err of validationErrors) {
        const constraints = err.constraints ? Object.values(err.constraints) : ['Valor inválido.'];
        for (const message of constraints) {
            formattedErrors.push({
                row: rowNumber,
                field: err.property,
                message
            });
        }
    }

    return formattedErrors;
};