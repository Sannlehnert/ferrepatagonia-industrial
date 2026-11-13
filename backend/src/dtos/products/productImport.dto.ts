import {
    IsBoolean,
    IsDefined,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    Validate,
    validate
} from 'class-validator';
import {
    FIELD_ERROR_CODE_MAP,
    PreviewProductOutput,
    RawImportRow,
    RowFieldError
} from './productImport.types';
import {
    MaxUtf8BytesConstraint,
    StrictDecimalScaleConstraint,
    ValidHttpUrlConstraint
} from './productImport.validators';

export * from './productImport.types';
export * from './productImport.validators';

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

    @IsOptional()
    @Validate(StrictDecimalScaleConstraint)
    @IsNumber(
        { allowNaN: false, allowInfinity: false },
        { message: 'El precio base USD debe ser un valor numérico válido con hasta 2 decimales.' }
    )
    @Min(0, { message: 'El precio base USD debe ser mayor o igual a 0.' })
    @Max(9999999999.99, { message: 'El precio base USD no debe superar 9999999999.99.' })
    precio_base_usd!: number | null;

    @IsDefined({ message: 'El stock es obligatorio.' })
    @IsInt({ message: 'El stock debe ser un número entero sin decimales.' })
    @Min(0, { message: 'El stock debe ser mayor o igual a 0.' })
    @Max(2147483647, { message: 'El stock no debe superar 2147483647.' })
    stock!: number;

    @IsOptional()
    @IsString({ message: 'La descripción debe ser texto.' })
    @Validate(MaxUtf8BytesConstraint)
    descripcion!: string | null;

    @IsOptional()
    @IsString({ message: 'La URL de la imagen debe ser texto.' })
    @MaxLength(2048, { message: 'La URL de la imagen no debe superar los 2048 caracteres.' })
    @Validate(ValidHttpUrlConstraint)
    imagen!: string | null;

    @IsOptional()
    @IsBoolean({ message: 'El campo activo debe ser booleano (true/false, 1/0, si/no).' })
    activo!: boolean;

    @IsOptional()
    @Validate(StrictDecimalScaleConstraint)
    @IsNumber(
        { allowNaN: false, allowInfinity: false },
        { message: 'El descuento especial debe ser un número válido con hasta 2 decimales.' }
    )
    @Min(0, { message: 'El descuento especial debe ser mayor o igual a 0.' })
    @Max(99.99, { message: 'El descuento especial no debe superar 99.99.' })
    descuento_especial_pct!: number | null;
}

const parseStrictInteger = (raw: unknown): unknown => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'number') return Number.isInteger(raw) ? raw : Number.NaN;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '') return undefined;
        return /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    }
    return raw;
};

const parseNullableStrictDecimal = (raw: unknown): number | null => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return Number.NaN;
        return /^-?\d+(\.\d{1,2})?$/.test(raw.toString()) ? raw : Number.NaN;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '') return null;
        const normalized = trimmed.replace(',', '.');
        return /^-?\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : Number.NaN;
    }
    return Number.NaN;
};

const parseStrictBoolean = (raw: unknown): unknown => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'boolean') return raw;
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
    dto.precio_base_usd = parseNullableStrictDecimal(raw.precio_base_usd);
    dto.stock = parseStrictInteger(raw.stock) as number;

    dto.descripcion =
        raw.descripcion === undefined || raw.descripcion === null || String(raw.descripcion).trim() === ''
            ? null
            : String(raw.descripcion).trim();

    dto.imagen =
        raw.imagen === undefined || raw.imagen === null || String(raw.imagen).trim() === ''
            ? null
            : String(raw.imagen).trim();

    const parsedActivo = parseStrictBoolean(raw.activo);
    dto.activo = parsedActivo === undefined ? true : (parsedActivo as boolean);
    dto.descuento_especial_pct = parseNullableStrictDecimal(raw.descuento_especial_pct);

    return dto;
};

export const formatPreviewProductOutput = (dto: ProductImportRowDto): PreviewProductOutput => ({
    codigo: dto.codigo,
    nombre: dto.nombre,
    id_categoria: dto.id_categoria,
    precio_base_usd:
        typeof dto.precio_base_usd === 'number' && Number.isFinite(dto.precio_base_usd)
            ? dto.precio_base_usd.toFixed(2)
            : null,
    stock: dto.stock,
    descripcion: dto.descripcion ?? null,
    imagen: dto.imagen ?? null,
    activo: Boolean(dto.activo),
    descuento_especial_pct:
        typeof dto.descuento_especial_pct === 'number' && Number.isFinite(dto.descuento_especial_pct)
            ? Number(dto.descuento_especial_pct.toFixed(2))
            : null
});

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
        const code = FIELD_ERROR_CODE_MAP[err.property] || 'VALIDATION_ERROR';
        for (const message of constraints) {
            formattedErrors.push({ row: rowNumber, field: err.property, code, message });
        }
    }
    return formattedErrors;
};