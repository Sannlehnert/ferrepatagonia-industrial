import api from '@/services/api';

export interface AdminProduct {
    id_producto: number;
    id_categoria: number;
    categoria_nombre?: string;
    codigo: string;
    nombre: string;
    descripcion: string | null;
    precio: number;
    stock: number;
    imagen: string | null;
    activo: boolean | number;
}

export interface CategoryOption {
    id_categoria: number;
    nombre: string;
    activo?: boolean | number;
}

export interface ProductPayload {
    nombre: string;
    codigo: string;
    id_categoria: number;
    precio: number;
    stock: number;
    descripcion: string | null;
    imagen: string | null;
    activo: boolean;
}

export async function getAdminProducts(): Promise<AdminProduct[]> {
    const response = await api.get<any>('/admin/productos');
    const raw = response.data;
    
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.productos)) return raw.productos;
    if (Array.isArray(raw?.data?.productos)) return raw.data.productos;
    return [];
}

export async function getActiveCategories(): Promise<CategoryOption[]> {
    const response = await api.get<any>('/categorias');
    const raw = response.data;

    // Extraemos de forma segura el arreglo independientemente de la estructura del backend
    let list: any[] = [];
    if (Array.isArray(raw)) {
        list = raw;
    } else if (Array.isArray(raw?.data)) {
        list = raw.data;
    } else if (Array.isArray(raw?.categorias)) {
        list = raw.categorias;
    } else if (Array.isArray(raw?.data?.categorias)) {
        list = raw.data.categorias;
    } else if (Array.isArray(raw?.data?.data)) {
        list = raw.data.data;
    }

    return list
        .filter((c) => c && (c.activo === undefined || Boolean(c.activo)))
        .map((c) => ({
            id_categoria: Number(c.id_categoria ?? c.id),
            nombre: String(c.nombre ?? ''),
            activo: c.activo
        }));
}

export async function saveAdminProduct(
    payload: ProductPayload,
    productId?: number
): Promise<AdminProduct> {
    if (productId) {
        const response = await api.put<AdminProduct>(`/admin/productos/${productId}`, payload);
        return response.data;
    } else {
        const response = await api.post<AdminProduct>('/admin/productos', payload);
        return response.data;
    }
}