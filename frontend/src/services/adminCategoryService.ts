import api from '@/services/api'

export interface AdminCategory {
  id_categoria: number
  nombre: string
  descripcion: string | null
  activo: 0 | 1
}

interface CategoryFields {
  nombre: string
  descripcion?: string | null
}

const categoriesPath = '/admin/categorias'

export async function listAdminCategories(signal?: AbortSignal): Promise<AdminCategory[]> {
  const { data } = await api.get<{ data: { categorias: AdminCategory[] } }>(
    categoriesPath,
    { signal },
  )
  return data.data.categorias
}

export async function createAdminCategory(input: CategoryFields): Promise<AdminCategory> {
  const { data } = await api.post<AdminCategory>(categoriesPath, input)
  return data
}

export async function updateAdminCategory(
  id: number,
  input: Partial<CategoryFields>,
): Promise<AdminCategory> {
  const { data } = await api.put<AdminCategory>(`${categoriesPath}/${id}`, input)
  return data
}

export async function deactivateAdminCategory(id: number): Promise<AdminCategory> {
  const { data } = await api.patch<AdminCategory>(`${categoriesPath}/${id}/desactivar`)
  return data
}