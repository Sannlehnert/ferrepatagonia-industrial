import type { AxiosRequestConfig } from 'axios';
import api from '@/services/api';

export interface AdminProduct {
    id_producto: number;
    id_categoria: number;
    categoria_nombre?: string;
    codigo: string;
    nombre: string;
    descripcion: string | null;
    precio: number | string | null; // <-- Permitir null y string además de number
    stock: number;
    imagen: string | null;
    activo: number | boolean;
}

export interface CategoryOption {
    id_categoria: number;
    nombre: string;
    activo?: boolean | number | string;
}

export function isCategoryActive(category: Pick<CategoryOption, 'activo'>): boolean {
    return (
        category.activo === undefined ||
        category.activo === true ||
        category.activo === 1 ||
        category.activo === '1' ||
        category.activo === 'true'
    );
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

export async function getAdminProducts(
    requestConfig?: Pick<AxiosRequestConfig, 'signal' | 'timeout'>,
): Promise<AdminProduct[]> {
    const response = requestConfig
        ? await api.get<any>('/admin/productos', requestConfig)
        : await api.get<any>('/admin/productos');
    const raw = response.data;

    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.productos)) return raw.productos;
    if (Array.isArray(raw?.data?.productos)) return raw.data.productos;
    // An invalid response must not unlock mutations after an uncertain save.
    throw new Error('La respuesta del listado de productos no es válida.');
}

export async function setAdminProductActive(productId: number, active: boolean): Promise<void> {
    if (active) await api.put(`/admin/productos/${productId}`, { activo: true });
    else await api.patch(`/admin/productos/${productId}/desactivar`);
}

export async function updateAdminProductStock(productId: number, stock: number): Promise<void> {
    await api.patch(`/admin/productos/${productId}/stock`, { stock });
}

export async function getActiveCategories(
    requestConfig?: Pick<AxiosRequestConfig, 'signal' | 'timeout'>,
): Promise<CategoryOption[]> {
    const response = requestConfig
        ? await api.get<any>('/categorias', requestConfig)
        : await api.get<any>('/categorias');
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
        .filter((c) => c && isCategoryActive(c))
        .map((c) => ({
            id_categoria: Number(c.id_categoria ?? c.id),
            nombre: String(c.nombre ?? ''),
            activo: c.activo
        }));
}

export async function saveAdminProduct(
    payload: ProductPayload,
    productId?: number,
    requestConfig?: Pick<AxiosRequestConfig, 'signal' | 'timeout'>,
): Promise<AdminProduct> {
    if (productId) {
        const response = await api.put<AdminProduct>(
            `/admin/productos/${productId}`,
            payload,
            requestConfig,
        );
        return response.data;
    } else {
        const response = await api.post<AdminProduct>(
            '/admin/productos',
            payload,
            requestConfig,
        );
        return response.data;
    }
}
