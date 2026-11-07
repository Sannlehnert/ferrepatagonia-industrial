export interface RawImportRow {
    codigo?: unknown;
    nombre?: unknown;
    id_categoria?: unknown;
    precio_base_usd?: unknown;
    stock?: unknown;
    descripcion?: unknown;
    imagen?: unknown;
    activo?: unknown;
    descuento_especial_pct?: unknown;
}

export interface RowFieldIssue {
    field: string;
    code: string;
    message: string;
}

export interface RowFieldError extends RowFieldIssue {
    row: number;
}

export interface PreviewProductOutput {
    codigo: string;
    nombre: string;
    id_categoria: number;
    precio_base_usd: string | null;
    stock: number;
    descripcion: string | null;
    imagen: string | null;
    activo: boolean;
    descuento_especial_pct: number | null;
}

export interface PreviewValidRowItem {
    row: number;
    producto: PreviewProductOutput;
}

export const FIELD_ERROR_CODE_MAP: Record<string, string> = {
    codigo: 'INVALID_SKU',
    nombre: 'INVALID_NAME',
    id_categoria: 'INVALID_CATEGORY',
    precio_base_usd: 'INVALID_PRICE',
    stock: 'INVALID_STOCK',
    descripcion: 'INVALID_DESCRIPTION',
    imagen: 'INVALID_IMAGE',
    activo: 'INVALID_ACTIVE',
    descuento_especial_pct: 'INVALID_DISCOUNT'
};